from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.browser_executor_agent import (
    AdkBrowserExecutor,
    BrowserAgentCompletion,
    BrowserExecutionTask,
)
from app.browser_executor_agent import (
    BrowserExecutorOutputError as ExecutorOutputError,
)
from app.browser_facade import BackendObservation, RestrictedBrowserSession
from app.browser_policy import (
    BrowserActionKind,
    BrowserTargetPolicy,
    CredentialReference,
)
from app.oracle_evaluation import OracleCheckStatus
from app.test_design import OracleKind
from tests.integration.test_browser_facade import (
    _BackendDouble,
    _CredentialResolverDouble,
)
from tests.integration.test_plan_reviewer_agent import _review_task


class _ScenarioBackend(_BackendDouble):
    async def observe(
        self,
        kind: OracleKind,
        subject: str,
    ) -> BackendObservation:
        self.observations.append((kind, subject))
        return BackendObservation(
            actual=None if subject == "profile error alert" else "Updated Name",
            evidence_ref=f"evidence://oracle/{len(self.observations)}",
        )


class _FailingScenarioBackend(_ScenarioBackend):
    async def observe(
        self,
        kind: OracleKind,
        subject: str,
    ) -> BackendObservation:
        observation = await super().observe(kind, subject)
        if subject == "profile display name":
            return observation.model_copy(update={"actual": "Original Name"})
        return observation


class _BrowserModel(BaseLlm):
    responses: list[LlmResponse]
    requests: list[LlmRequest]

    def __init__(self, responses: list[LlmResponse]) -> None:
        super().__init__(
            model="test-browser-model",
            responses=responses,
            requests=[],
        )

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        assert stream is False
        self.requests.append(llm_request)
        yield self.responses.pop(0)


def _tool_call(name: str, args: dict[str, object]) -> LlmResponse:
    return LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part.from_function_call(name=name, args=args)],
        )
    )


def _final(completion: BrowserAgentCompletion) -> LlmResponse:
    return LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(text=completion.model_dump_json())],
        )
    )


def _execution_task() -> BrowserExecutionTask:
    scenario = _review_task().plan.scenarios[0]
    return BrowserExecutionTask(
        project_id="project-alpha",
        scenario=scenario,
        target_policy=BrowserTargetPolicy(
            project_id="project-alpha",
            start_url="https://app.example.test/profile",
            allowed_origins=("https://app.example.test",),
            allowed_actions=(
                BrowserActionKind.NAVIGATE,
                BrowserActionKind.SNAPSHOT,
                BrowserActionKind.OBSERVE_ORACLE,
            ),
            credential_references=(
                CredentialReference(
                    name="primary-login",
                    secret_ref="projects/project-alpha/secrets/primary-login",
                ),
            ),
            safe_consequential_actions=(),
            max_steps=8,
            timeout_seconds=300,
        ),
    )


@pytest.mark.asyncio
async def test_browser_executor_explores_but_harness_assigns_the_verdict() -> None:
    task = _execution_task()
    oracle_ids = tuple(
        oracle.oracle_id
        for oracle in (
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        )
    )
    model = _BrowserModel(
        [
            _tool_call("navigate", {"url": task.target_policy.start_url}),
            _tool_call("snapshot", {}),
            *[
                _tool_call("observe_oracle", {"oracle_id": oracle_id})
                for oracle_id in oracle_ids
            ],
            _final(
                BrowserAgentCompletion(
                    scenario_id=task.scenario.scenario_id,
                    observed_oracle_ids=oracle_ids,
                )
            ),
        ]
    )
    backend = _ScenarioBackend()
    session = RestrictedBrowserSession(
        policy=task.target_policy,
        approved_oracles=(
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        ),
        backend=backend,
        credentials=_CredentialResolverDouble(),
    )
    executor = AdkBrowserExecutor(model=model)

    result = await executor.execute(task, session=session)

    assert result.evaluation.passed is True
    assert result.step_count == 4
    assert all(
        check.status is OracleCheckStatus.PASSED for check in result.evaluation.checks
    )
    assert backend.started == 1
    assert backend.closed == 1
    first_payload = json.loads(model.requests[0].contents[0].parts[0].text)
    assert first_payload["project_id"] == task.project_id
    assert first_payload["scenario"] == task.scenario.model_dump(mode="json")
    assert first_payload["target_policy"]["credential_names"] == ["primary-login"]
    assert "secret_ref" not in json.dumps(first_payload)


@pytest.mark.asyncio
async def test_browser_executor_cannot_claim_unrecorded_oracles() -> None:
    task = _execution_task()
    oracle_ids = tuple(
        oracle.oracle_id
        for oracle in (
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        )
    )
    model = _BrowserModel(
        [
            _tool_call("navigate", {"url": task.target_policy.start_url}),
            _tool_call("snapshot", {}),
            _final(
                BrowserAgentCompletion(
                    scenario_id=task.scenario.scenario_id,
                    observed_oracle_ids=oracle_ids,
                )
            ),
        ]
    )
    backend = _ScenarioBackend()
    session = RestrictedBrowserSession(
        policy=task.target_policy,
        approved_oracles=(
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        ),
        backend=backend,
        credentials=_CredentialResolverDouble(),
    )

    with pytest.raises(ExecutorOutputError):
        await AdkBrowserExecutor(model=model).execute(task, session=session)

    assert backend.closed == 1


@pytest.mark.asyncio
async def test_harness_fails_a_scenario_even_when_agent_completes_it() -> None:
    task = _execution_task()
    oracle_ids = tuple(
        oracle.oracle_id
        for oracle in (
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        )
    )
    model = _BrowserModel(
        [
            _tool_call("navigate", {"url": task.target_policy.start_url}),
            _tool_call("snapshot", {}),
            *[
                _tool_call("observe_oracle", {"oracle_id": oracle_id})
                for oracle_id in oracle_ids
            ],
            _final(
                BrowserAgentCompletion(
                    scenario_id=task.scenario.scenario_id,
                    observed_oracle_ids=oracle_ids,
                )
            ),
        ]
    )
    backend = _FailingScenarioBackend()
    session = RestrictedBrowserSession(
        policy=task.target_policy,
        approved_oracles=(
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        ),
        backend=backend,
        credentials=_CredentialResolverDouble(),
    )

    result = await AdkBrowserExecutor(model=model).execute(task, session=session)

    assert result.evaluation.passed is False
    assert [check.status for check in result.evaluation.checks].count(
        OracleCheckStatus.FAILED
    ) == 1
