import datetime

from accounts.models import Employee, Role
from departments.models import Department
from leave_types.models import AccrualMethod, LeaveType


def make_department(name="Engineering"):
    return Department.objects.create(name=name)


def make_manager(department, email="manager@example.com"):
    return Employee.objects.create_user(
        email=email, name="Manager", password="Pass1234567",
        role=Role.MANAGER, title="Engineering Manager", department=department,
        joined_at=datetime.date(2015, 1, 1),
    )


def make_employee(department, manager=None, email="employee@example.com", joined_at=None):
    return Employee.objects.create_user(
        email=email, name="Employee", password="Pass1234567",
        role=Role.EMPLOYEE, title="Engineer", department=department, manager=manager,
        joined_at=joined_at or datetime.date(2020, 1, 1),
    )


def make_leave_type(
    name="Annual Leave", code="AL", default_days_per_year=20, requires_approval=True,
    accrual_method=AccrualMethod.ANNUAL, carry_forward_limit=0, is_active=True,
):
    return LeaveType.objects.create(
        name=name, code=code, default_days_per_year=default_days_per_year,
        requires_approval=requires_approval, accrual_method=accrual_method,
        carry_forward_limit=carry_forward_limit, is_active=is_active,
    )
