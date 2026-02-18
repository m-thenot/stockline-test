"""Domain layer - contains protocols (interfaces) and business logic abstractions."""

from .repositories import EntityProtocol, IEntityRepository, IOperationLogRepository

__all__ = ["EntityProtocol", "IEntityRepository", "IOperationLogRepository"]
