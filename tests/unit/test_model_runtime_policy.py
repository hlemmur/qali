from __future__ import annotations

import pytest
from google.adk.models import Gemini

from app.failure_investigator_agents import (
    create_failure_investigator_agent,
    create_failure_reviewer_agent,
)
from app.knowledge_analyst_agent import create_knowledge_analyst_agent
from app.knowledge_reviewer_agent import create_knowledge_reviewer_agent
from app.plan_reviewer_agent import create_plan_reviewer_agent
from app.product_alignment_agent import create_product_alignment_agent
from app.qa_strategy_agent import create_qa_strategy_agent
from app.risk_analysis_agent import create_risk_analysis_agent
from app.slack_coordinator import create_slack_coordinator_agent
from app.test_designer_agent import create_test_designer_agent

_STRUCTURED_AGENT_FACTORIES = (
    create_slack_coordinator_agent,
    create_knowledge_analyst_agent,
    create_knowledge_reviewer_agent,
    create_product_alignment_agent,
    create_qa_strategy_agent,
    create_risk_analysis_agent,
    create_test_designer_agent,
    create_plan_reviewer_agent,
    create_failure_investigator_agent,
    create_failure_reviewer_agent,
)


def test_default_coordinator_model_is_bounded_and_does_not_retry_quota() -> None:
    agent = create_slack_coordinator_agent()

    assert isinstance(agent.model, Gemini)
    assert agent.model.model == "gemini-3.7-flash"
    assert agent.model.retry_options is not None
    assert agent.model.retry_options.attempts == 3
    assert agent.model.retry_options.max_delay == 8
    status_codes = agent.model.retry_options.http_status_codes
    assert status_codes == [408, 500, 502, 503, 504]
    assert status_codes is not None
    assert 429 not in status_codes
    assert agent.generate_content_config is not None
    assert agent.generate_content_config.temperature == 0
    assert agent.generate_content_config.max_output_tokens == 4_096


@pytest.mark.parametrize("agent_factory", _STRUCTURED_AGENT_FACTORIES)
def test_every_tool_free_agent_uses_the_same_bounded_default_policy(
    agent_factory,
) -> None:
    agent = agent_factory()

    assert isinstance(agent.model, Gemini)
    assert agent.model.model == "gemini-3.7-flash"
    assert agent.model.retry_options is not None
    assert agent.model.retry_options.http_status_codes == [408, 500, 502, 503, 504]
    assert agent.generate_content_config is not None
    assert agent.generate_content_config.temperature == 0
    assert agent.generate_content_config.max_output_tokens == 4_096
