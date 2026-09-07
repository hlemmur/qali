from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
)
from app.product_alignment import (
    GroundedProductStatement,
    ProductAlignmentStatus,
    ProductAlignmentTask,
    ProductIntent,
)
from app.product_alignment_agent import (
    AdkProductAlignmentAnalyst,
    ProductAlignmentOutputError,
    create_product_alignment_agent,
)


class _StructuredAlignmentModel(BaseLlm):
    response: ProductIntent
    requests: list[LlmRequest]

    def __init__(self, response: ProductIntent) -> None:
        super().__init__(
            model="test-product-alignment-model",
            response=response,
            requests=[],
        )

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        assert stream is False
        self.requests.append(llm_request)
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=self.response.model_dump_json())],
            )
        )


def _knowledge() -> KnowledgeCompilation:
    return KnowledgeCompilation(
        project_id="project-alpha",
        overview="A customer profile application.",
        facts=(
            KnowledgeFact(
                statement="Customers can update their display name.",
                source_ids=("source-profile",),
            ),
            KnowledgeFact(
                statement="Saving returns the customer to the profile page.",
                source_ids=("source-profile",),
            ),
        ),
        contradictions=(),
        gaps=(),
        confidence=KnowledgeConfidence.HIGH,
    )


def _task() -> ProductAlignmentTask:
    return ProductAlignmentTask(
        project_id="project-alpha",
        request="Test profile display-name editing.",
        knowledge=_knowledge(),
    )


def _intent() -> ProductIntent:
    return ProductIntent(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        user_value=GroundedProductStatement(
            statement="Customers can keep their visible identity current.",
            source_ids=("source-profile",),
        ),
        expected_behaviors=(
            GroundedProductStatement(
                statement="The saved display name is shown on the profile page.",
                source_ids=("source-profile",),
            ),
        ),
        prerequisites=(),
        in_scope=(
            GroundedProductStatement(
                statement="Editing and saving the display name",
                source_ids=("source-profile",),
            ),
        ),
        out_of_scope=("Changing account credentials",),
        ambiguities=(),
        status=ProductAlignmentStatus.READY,
    )


@pytest.mark.asyncio
async def test_product_alignment_grounds_one_feature_in_isolated_knowledge() -> None:
    expected = _intent()
    model = _StructuredAlignmentModel(expected)
    analyst = AdkProductAlignmentAnalyst(
        agent=create_product_alignment_agent(model=model),
    )

    result = await analyst.align(_task())

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload == {
        "project_id": "project-alpha",
        "request": "Test profile display-name editing.",
        "knowledge": _knowledge().model_dump(mode="json"),
    }


@pytest.mark.asyncio
async def test_product_alignment_rejects_unsupported_source_citations() -> None:
    unsupported = _intent().model_copy(
        update={
            "expected_behaviors": (
                GroundedProductStatement(
                    statement="Saving sends a confirmation email.",
                    source_ids=("source-invented",),
                ),
            ),
        }
    )
    analyst = AdkProductAlignmentAnalyst(
        agent=create_product_alignment_agent(
            model=_StructuredAlignmentModel(unsupported)
        ),
    )

    with pytest.raises(ProductAlignmentOutputError):
        await analyst.align(_task())


@pytest.mark.asyncio
async def test_product_alignment_rejects_unsupported_user_value() -> None:
    unsupported = _intent().model_copy(
        update={
            "user_value": GroundedProductStatement(
                statement="Customers receive loyalty rewards.",
                source_ids=("source-invented",),
            ),
        }
    )
    analyst = AdkProductAlignmentAnalyst(
        agent=create_product_alignment_agent(
            model=_StructuredAlignmentModel(unsupported)
        ),
    )

    with pytest.raises(ProductAlignmentOutputError):
        await analyst.align(_task())


@pytest.mark.asyncio
async def test_product_alignment_rejects_unsupported_feature_scope() -> None:
    unsupported = _intent().model_copy(
        update={
            "in_scope": (
                GroundedProductStatement(
                    statement="Editing payment methods",
                    source_ids=("source-invented",),
                ),
            ),
        }
    )
    analyst = AdkProductAlignmentAnalyst(
        agent=create_product_alignment_agent(
            model=_StructuredAlignmentModel(unsupported)
        ),
    )

    with pytest.raises(ProductAlignmentOutputError):
        await analyst.align(_task())


@pytest.mark.asyncio
async def test_product_alignment_rejects_cross_project_output() -> None:
    cross_project = _intent().model_copy(update={"project_id": "project-other"})
    analyst = AdkProductAlignmentAnalyst(
        agent=create_product_alignment_agent(
            model=_StructuredAlignmentModel(cross_project)
        ),
    )

    with pytest.raises(ProductAlignmentOutputError):
        await analyst.align(_task())
