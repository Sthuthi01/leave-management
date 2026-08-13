from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .models import Holiday


class HolidaySerializer(serializers.ModelSerializer):
    date = serializers.DateField(
        error_messages={"invalid": "Enter a valid date in YYYY-MM-DD format."},
        validators=[
            UniqueValidator(
                queryset=Holiday.objects.all(),
                message="A holiday already exists on this date.",
            )
        ],
    )

    class Meta:
        model = Holiday
        fields = ["id", "name", "date", "optional", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Name must be at least 2 characters.")
        return value
