from __future__ import annotations

from fastapi import FastAPI
from google.adk.models.base_llm import BaseLlm

from app.browser_policy import BrowserTargetPolicy
from app.knowledge_quality import KnowledgeQualityPolicy
from app.knowledge_runtime import create_adk_knowledge_workflow
from app.knowledge_workflow import KnowledgeRepository
from app.onboarding_knowledge_flow import (
    FeatureContextPublishingOnboardingFlow,
    FeatureContextRepository,
    OnboardingKnowledgeFlow,
    SourceFlow,
    SourceLoader,
)
from app.onboarding_processor import (
    OnboardingProgressProcessor,
    ProgressReporter,
    ProgressRepository,
)
from app.worker_handler import (
    JobExecutionSettings,
    JobLifecycleRepository,
    LifecycleJobHandler,
)
from app.worker_ingress import WorkerIngressSettings, create_worker_app


class OnboardingJobRepository(
    JobLifecycleRepository,
    ProgressRepository,
):
    """Durable job boundary shared by lifecycle and Slack progress handling."""


def create_onboarding_worker_app(
    *,
    settings: WorkerIngressSettings,
    jobs: OnboardingJobRepository,
    progress: ProgressReporter,
    source_flow: SourceFlow,
    source_loader: SourceLoader,
    knowledge_repository: KnowledgeRepository,
    feature_context_repository: FeatureContextRepository | None = None,
    target_policy: BrowserTargetPolicy | None = None,
    analyst_model: BaseLlm | str | None = None,
    reviewer_model: BaseLlm | str | None = None,
    quality_policy: KnowledgeQualityPolicy | None = None,
    execution_settings: JobExecutionSettings | None = None,
) -> FastAPI:
    """Compose the production onboarding graph behind the worker HTTP boundary."""

    knowledge_workflow = create_adk_knowledge_workflow(
        repository=knowledge_repository,
        analyst_model=analyst_model,
        reviewer_model=reviewer_model,
        quality_policy=quality_policy,
    )
    onboarding: OnboardingKnowledgeFlow | FeatureContextPublishingOnboardingFlow
    onboarding = OnboardingKnowledgeFlow(
        source_flow=source_flow,
        source_loader=source_loader,
        knowledge_workflow=knowledge_workflow,
    )
    if (feature_context_repository is None) is not (target_policy is None):
        raise ValueError(
            "feature context repository and target policy must be configured together"
        )
    if feature_context_repository is not None and target_policy is not None:
        onboarding = FeatureContextPublishingOnboardingFlow(
            delegate=onboarding,
            contexts=feature_context_repository,
            target_policy=target_policy,
        )
    processor = OnboardingProgressProcessor(
        jobs=jobs,
        progress=progress,
        delegate=onboarding,
    )
    handler = LifecycleJobHandler(
        jobs=jobs,
        processor=processor,
        settings=execution_settings,
    )
    return create_worker_app(settings=settings, handler=handler)


__all__ = ["OnboardingJobRepository", "create_onboarding_worker_app"]
