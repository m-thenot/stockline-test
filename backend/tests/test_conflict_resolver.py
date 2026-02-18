from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.schemas import ConflictWinner
from app.services.conflict_resolver import (
    ConflictResolver,
    _values_equal,
    parse_timestamp,
)


class TestConflictResolver:
    """Unit tests for ConflictResolver."""

    @pytest.fixture
    def resolver(self) -> ConflictResolver:
        """Fixture to create a ConflictResolver instance."""
        return ConflictResolver()

    def test_version_match(self, resolver: ConflictResolver) -> None:
        """When expected_version == server_version, all client fields are applied."""
        server_state = {"name": "Server Name", "status": 1}
        client_data = {"name": "Client Name", "status": 2}
        expected_version = 5
        server_version = 5
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {}

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is False
        assert result.fields_to_apply == client_data
        assert result.auto_merged == []
        assert result.lww_resolved == []

    def test_version_mismatch_identical_values_string(self, resolver: ConflictResolver) -> None:
        """Fields with identical values (string) are ignored (no-op)."""
        server_state = {"name": "Same Name"}
        client_data = {"name": "Same Name"}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {"name": "2024-01-15T09:00:00Z"}

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert result.fields_to_apply == {}
        assert result.auto_merged == []
        assert result.lww_resolved == []

    def test_version_mismatch_identical_values_int(self, resolver: ConflictResolver) -> None:
        """Fields with identical values (int) are ignored (no-op)."""
        server_state = {"status": 1}
        client_data = {"status": 1}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {"status": "2024-01-15T09:00:00Z"}

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert result.fields_to_apply == {}
        assert result.auto_merged == []
        assert result.lww_resolved == []

    def test_version_mismatch_identical_values_uuid(self, resolver: ConflictResolver) -> None:
        """Fields with identical values (UUID) are ignored (no-op)."""
        test_uuid = uuid.uuid4()
        server_state = {"partner_id": str(test_uuid)}
        client_data = {"partner_id": test_uuid}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {"partner_id": "2024-01-15T09:00:00Z"}

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert result.fields_to_apply == {}
        assert result.auto_merged == []
        assert result.lww_resolved == []

    def test_version_mismatch_auto_merge(self, resolver: ConflictResolver) -> None:
        """Fields not modified on server since expected_version are auto-merged."""
        server_state = {"name": "Server Name", "status": 1}
        client_data = {"name": "Client Name", "status": 2}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        # name was not modified on server since expected_version
        server_changed_fields = {}  # No fields modified

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert set(result.fields_to_apply.keys()) == {"name", "status"}
        assert result.fields_to_apply["name"] == "Client Name"
        assert result.fields_to_apply["status"] == 2
        assert set(result.auto_merged) == {"name", "status"}
        assert result.lww_resolved == []

    def test_version_mismatch_auto_merge_partial(self, resolver: ConflictResolver) -> None:
        """Partial auto-merge: some fields modified, others not."""
        server_state = {"name": "Server Name", "status": 1, "code": "ABC"}
        client_data = {"name": "Client Name", "status": 2, "code": "XYZ"}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        # Only 'name' was modified on server
        server_changed_fields = {"name": "2024-01-15T09:00:00Z"}

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        # status and code are auto-merged
        assert "status" in result.auto_merged
        assert "code" in result.auto_merged
        assert result.fields_to_apply["status"] == 2
        assert result.fields_to_apply["code"] == "XYZ"
        # name must be resolved via LWW
        assert len(result.lww_resolved) == 1
        assert result.lww_resolved[0].field == "name"
        assert result.lww_resolved[0].winner == ConflictWinner.CLIENT
        assert result.lww_resolved[0].client_value == "Client Name"
        assert result.lww_resolved[0].server_value == "Server Name"

    def test_lww_client_wins(self, resolver: ConflictResolver) -> None:
        """When client_timestamp >= server_field_timestamp, client wins."""
        server_state = {"name": "Server Name"}
        client_data = {"name": "Client Name"}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {"name": "2024-01-15T09:00:00Z"}  # Older

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert result.fields_to_apply["name"] == "Client Name"
        assert len(result.lww_resolved) == 1
        assert result.lww_resolved[0].field == "name"
        assert result.lww_resolved[0].client_value == "Client Name"
        assert result.lww_resolved[0].server_value == "Server Name"
        assert result.lww_resolved[0].winner == ConflictWinner.CLIENT

    def test_lww_server_wins(self, resolver: ConflictResolver) -> None:
        """When client_timestamp < server_field_timestamp, server wins."""
        server_state = {"name": "Server Name"}
        client_data = {"name": "Client Name"}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {"name": "2024-01-15T11:00:00Z"}  # Newer

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert "name" not in result.fields_to_apply  # Server wins, so no application
        assert len(result.lww_resolved) == 1
        assert result.lww_resolved[0].field == "name"
        assert result.lww_resolved[0].client_value == "Client Name"
        assert result.lww_resolved[0].server_value == "Server Name"
        assert result.lww_resolved[0].winner == ConflictWinner.SERVER

    def test_lww_equal_timestamps(self, resolver: ConflictResolver) -> None:
        """Edge case where timestamps are equal (client wins with >=)."""
        server_state = {"name": "Server Name"}
        client_data = {"name": "Client Name"}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {"name": "2024-01-15T10:00:00Z"}  # Same timestamp

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert result.fields_to_apply["name"] == "Client Name"  # Client wins with >=
        assert len(result.lww_resolved) == 1
        assert result.lww_resolved[0].winner == ConflictWinner.CLIENT

    def test_empty_client_data(self, resolver: ConflictResolver) -> None:
        """Empty client_data returns an empty resolution."""
        server_state = {"name": "Server Name"}
        client_data = {}
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {}

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        assert result.fields_to_apply == {}
        assert result.auto_merged == []
        assert result.lww_resolved == []

    def test_multiple_fields_mixed_scenarios(self, resolver: ConflictResolver) -> None:
        """Mix of different scenarios in the same resolution."""
        server_state = {
            "name": "Server Name",
            "status": 1,  # Identical -> no-op
            "code": "ABC",  # Auto-merge
            "description": "Server Desc",  # LWW (client wins)
            "notes": "Server Notes",  # LWW (server wins)
        }
        client_data = {
            "name": "Client Name",  # LWW (client wins)
            "status": 1,  # Identical -> no-op
            "code": "XYZ",  # Auto-merge
            "description": "Client Desc",  # LWW (client wins)
            "notes": "Client Notes",  # LWW (server wins)
        }
        expected_version = 1
        server_version = 2
        client_timestamp = "2024-01-15T10:00:00Z"
        server_changed_fields = {
            "name": "2024-01-15T09:00:00Z",  # Client wins
            "description": "2024-01-15T09:00:00Z",  # Client wins
            "notes": "2024-01-15T11:00:00Z",  # Server wins
            # code is not in server_changed_fields -> auto-merge
        }

        result = resolver.resolve_update(
            server_state=server_state,
            client_data=client_data,
            expected_version=expected_version,
            server_version=server_version,
            client_timestamp=client_timestamp,
            server_changed_fields=server_changed_fields,
        )

        assert result.had_version_mismatch is True
        # status is not in fields_to_apply (identical)
        assert "status" not in result.fields_to_apply
        # code is auto-merged
        assert "code" in result.auto_merged
        assert result.fields_to_apply["code"] == "XYZ"
        # name and description are applied (client wins)
        assert result.fields_to_apply["name"] == "Client Name"
        assert result.fields_to_apply["description"] == "Client Desc"
        # notes is not applied (server wins)
        assert "notes" not in result.fields_to_apply
        # Check LWW conflicts
        assert len(result.lww_resolved) == 3
        lww_fields = {conflict.field for conflict in result.lww_resolved}
        assert lww_fields == {"name", "description", "notes"}
        # Check winners
        name_conflict = next(c for c in result.lww_resolved if c.field == "name")
        assert name_conflict.winner == ConflictWinner.CLIENT
        desc_conflict = next(c for c in result.lww_resolved if c.field == "description")
        assert desc_conflict.winner == ConflictWinner.CLIENT
        notes_conflict = next(c for c in result.lww_resolved if c.field == "notes")
        assert notes_conflict.winner == ConflictWinner.SERVER


class TestParseTimestamp:
    """Tests for the parse_timestamp function."""

    def test_parse_timestamp_with_timezone(self) -> None:
        """Timestamp with timezone is correctly parsed."""
        ts = "2024-01-15T10:00:00+00:00"
        result = parse_timestamp(ts)
        assert isinstance(result, datetime)
        assert result.tzinfo is not None
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 10

    def test_parse_timestamp_without_timezone(self) -> None:
        """Timestamp without timezone has UTC added."""
        ts = "2024-01-15T10:00:00"
        result = parse_timestamp(ts)
        assert isinstance(result, datetime)
        assert result.tzinfo == UTC
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 10

    def test_parse_timestamp_iso_format_z(self) -> None:
        """ISO 8601 format with Z (UTC)."""
        ts = "2024-01-15T10:00:00Z"
        result = parse_timestamp(ts)
        assert isinstance(result, datetime)
        assert result.tzinfo is not None
        assert result.year == 2024

    def test_parse_timestamp_with_milliseconds(self) -> None:
        """Timestamp with milliseconds."""
        ts = "2024-01-15T10:00:00.123Z"
        result = parse_timestamp(ts)
        assert isinstance(result, datetime)
        assert result.microsecond == 123000


class TestValuesEqual:
    """Tests for the _values_equal function."""

    def test_values_equal_strings(self) -> None:
        """String comparison."""
        assert _values_equal("hello", "hello") is True
        assert _values_equal("hello", "world") is False

    def test_values_equal_uuid_stringified(self) -> None:
        """Stringified UUID vs native UUID are considered equal."""
        test_uuid = uuid.uuid4()
        assert _values_equal(str(test_uuid), test_uuid) is True
        assert _values_equal(test_uuid, str(test_uuid)) is True
        assert _values_equal(test_uuid, test_uuid) is True

    def test_values_equal_different_types(self) -> None:
        """Different types but equal string representation."""
        assert _values_equal(123, "123") is True
        assert _values_equal("123", 123) is True
        assert _values_equal(123, 123) is True

    def test_values_equal_none(self) -> None:
        """Comparison with None."""
        assert _values_equal(None, None) is True
        assert _values_equal(None, "None") is True
        assert _values_equal("None", None) is True
        assert _values_equal(None, "") is False

    def test_values_equal_numbers(self) -> None:
        """Number comparison."""
        assert _values_equal(42, 42) is True
        assert _values_equal(42, 43) is False
