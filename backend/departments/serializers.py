from rest_framework import serializers

from .models import Department


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name"]

    def validate_name(self, value: str) -> str:
        # Case-insensitive duplicate check, matching the source app's
        # `d.name.toLowerCase() === name.toLowerCase()` check on both create and edit — the
        # model's own `unique=True` is a case-sensitive DB constraint and would let "Engineering"
        # and "engineering" both through. Excludes self on update so a no-op-case rename doesn't
        # falsely collide with itself.
        qs = Department.objects.filter(name__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A department with this name already exists.")
        return value
