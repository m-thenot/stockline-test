from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from ..schemas import ConflictWinner


@dataclass
class FieldConflict:
    """Describes how a single field conflict was resolved via LWW."""

    field: str
    client_value: Any
    server_value: Any
    winner: ConflictWinner


@dataclass
class ConflictResolution:
    """Result of a field-level merge between client and server state."""

    fields_to_apply: dict = field(default_factory=dict)
    had_version_mismatch: bool = False
    auto_merged: list[str] = field(default_factory=list)
    lww_resolved: list[FieldConflict] = field(default_factory=list)


class ConflictResolver:
    """
    Entity-agnostic conflict resolver implementing field-level merge with LWW.

    Rules:
    - Version match -> no conflict, apply all client fields
    - Version mismatch -> field-level analysis:
        - Field value identical on server -> auto-merge (no real conflict)
        - Field value differs -> LWW by timestamp (most recent wins)
    """

    def resolve_update(
        self,
        server_state: dict,
        client_data: dict,
        expected_version: int | None,
        server_version: int,
        client_timestamp: str,
        server_updated_at: str,
    ) -> ConflictResolution:
        # No version check requested or versions match -> apply directly
        if expected_version is None or expected_version == server_version:
            return ConflictResolution(
                fields_to_apply=dict(client_data),
                had_version_mismatch=False,
            )

        # Version mismatch -> field-level merge
        client_dt = parse_timestamp(client_timestamp)
        server_dt = parse_timestamp(server_updated_at)

        fields_to_apply: dict = {}
        auto_merged: list[str] = []
        lww_resolved: list[FieldConflict] = []

        for field_name, client_value in client_data.items():
            server_value = server_state.get(field_name)

            if _values_equal(client_value, server_value):
                # Client wants the same value the server already has -> no-op
                continue

            # Real conflict on this field -> LWW by timestamp
            if client_dt >= server_dt:
                # Client wins
                fields_to_apply[field_name] = client_value
                lww_resolved.append(
                    FieldConflict(
                        field=field_name,
                        client_value=client_value,
                        server_value=server_value,
                        winner=ConflictWinner.CLIENT,
                    )
                )
            else:
                # Server wins -> keep server value, don't apply
                lww_resolved.append(
                    FieldConflict(
                        field=field_name,
                        client_value=client_value,
                        server_value=server_value,
                        winner=ConflictWinner.SERVER,
                    )
                )

        return ConflictResolution(
            fields_to_apply=fields_to_apply,
            had_version_mismatch=True,
            auto_merged=auto_merged,
            lww_resolved=lww_resolved,
        )


def parse_timestamp(ts: str) -> datetime:
    """Parse an ISO 8601 timestamp string into a timezone-aware datetime."""
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _values_equal(a: Any, b: Any) -> bool:
    """Compare two values, treating stringified UUIDs and native UUIDs as equal."""
    return str(a) == str(b)
