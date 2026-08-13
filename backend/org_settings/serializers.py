from rest_framework import serializers

from .models import OrganizationSettings


class OrganizationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrganizationSettings
        fields = [
            "working_days",
            "pending_approval_urgency_days",
            "audit_log_display_limit",
            "session_max_age_days",
        ]

    def validate_working_days(self, value: list[int]) -> list[int]:
        if not value:
            raise serializers.ValidationError("working_days must be a non-empty list of numbers 0-6.")
        if any(day < 0 or day > 6 for day in value):
            raise serializers.ValidationError("working_days must only contain numbers 0-6.")
        return sorted(set(value))
