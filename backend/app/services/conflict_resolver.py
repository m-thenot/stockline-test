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
    Entity-agnostic conflict resolver implementing true field-level merge with LWW.

    Rules:
    - Version match -> no conflict, apply all client fields
    - Version mismatch -> per-field analysis using operation_log history:
        - Field value identical on server -> skip (no-op)
        - Field NOT changed on server since expected_version -> auto-merge (apply)
        - Field changed on server -> LWW using per-field timestamp from operation_log
    """

    def resolve_update(
        self,
        server_state: dict,
        client_data: dict,
        expected_version: int | None,
        server_version: int,
        client_timestamp: str,
        server_changed_fields: dict[str, str],
    ) -> ConflictResolution:
        # No version check requested or versions match -> apply directly
        if expected_version is None or expected_version == server_version:
            return ConflictResolution(
                fields_to_apply=dict(client_data),
                had_version_mismatch=False,
            )

        # Version mismatch -> field-level merge using operation_log history
        client_dt = parse_timestamp(client_timestamp)

        fields_to_apply: dict = {}
        auto_merged: list[str] = []
        lww_resolved: list[FieldConflict] = []

        for field_name, client_value in client_data.items():
            server_value = server_state.get(field_name)

            if _values_equal(client_value, server_value):
                # Client wants the same value the server already has -> no-op
                continue

            # Field was NOT changed on the server since expected_version -> auto-merge
            if field_name not in server_changed_fields:
                fields_to_apply[field_name] = client_value
                auto_merged.append(field_name)
                continue

            # Both client and server changed this field -> LWW per field
            server_field_dt = parse_timestamp(server_changed_fields[field_name])

            if client_dt >= server_field_dt:
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
