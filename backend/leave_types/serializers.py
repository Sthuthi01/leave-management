import re

from rest_framework import serializers

from .models import LeaveType

HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = [
            "id",
            "name",
            "code",
            "color",
            "default_days_per_year",
            "requires_approval",
            "is_active",
            "accrual_method",
            "carry_forward_limit",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_color(self, value):
        if not HEX_COLOR_RE.match(value):
            raise serializers.ValidationError("Color must be a hex code like #16a34a.")
        return value

    def validate_code(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        default_days = attrs.get(
            "default_days_per_year",
            getattr(self.instance, "default_days_per_year", None),
        )
        carry_forward = attrs.get(
            "carry_forward_limit",
            getattr(self.instance, "carry_forward_limit", None),
        )
        if (
            default_days is not None
            and carry_forward is not None
            and carry_forward > default_days
        ):
            raise serializers.ValidationError(
                {"carry_forward_limit": "Carry-forward limit cannot exceed the default days per year."}
            )
        return attrs
