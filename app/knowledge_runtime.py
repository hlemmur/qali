from __future__ import annotations

from google.adk.models.base_llm import BaseLlm

from app.knowledge_analyst_agent import (
    AdkKnowledgeAnalyst,
    create_knowledge_analyst_agent,
)
from app.knowledge_quality import KnowledgeQualityPolicy
from app.knowledge_reviewer_agent import (
    AdkKnowledgeReviewer,
    create_knowledge_reviewer_agent,
)
from app.knowledge_workflow import KnowledgeRepository, KnowledgeWorkflow


def create_adk_knowledge_workflow(
    *,
    repository: KnowledgeRepository,
    analyst_model: BaseLlm | str | None = None,
    reviewer_model: BaseLlm | str | None = None,
    quality_policy: KnowledgeQualityPolicy | None = None,
) -> KnowledgeWorkflow:
    analyst = AdkKnowledgeAnalyst(
        agent=create_knowledge_analyst_agent(model=analyst_model)
    )
    reviewer = AdkKnowledgeReviewer(
        agent=create_knowledge_reviewer_agent(model=reviewer_model)
    )
    return KnowledgeWorkflow(
        analyst=analyst,
        reviewer=reviewer,
        repository=repository,
        quality_policy=quality_policy,
    )


__all__ = ["create_adk_knowledge_workflow"]
