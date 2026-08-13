from accounts.models import Employee, Role
from departments.models import Department
from onboarding.models import AudienceScope, Checklist, Resource, ResourceCategory, ResourceStatus, Task


def make_department(name="Engineering"):
    return Department.objects.create(name=name)


def make_admin(department, email="admin@example.com"):
    return Employee.objects.create_user(
        email=email, name="Admin", password="AdminPass123",
        role=Role.ADMIN, title="HR Administrator", department=department,
    )


def make_employee(department, email="employee@example.com", role=Role.EMPLOYEE, manager=None):
    return Employee.objects.create_user(
        email=email, name="Employee", password="EmployeePass123",
        role=role, title="Engineer", department=department, manager=manager,
    )


def make_resource(
    title="Employee Handbook",
    category=ResourceCategory.GUIDE,
    description="Read this first.",
    content="Welcome!",
    status=ResourceStatus.PUBLISHED,
    audience_scope=AudienceScope.ALL,
    audience_department=None,
    audience_role=None,
    effective_date=None,
    is_required=False,
):
    return Resource.objects.create(
        title=title,
        category=category,
        description=description,
        content=content,
        status=status,
        audience_scope=audience_scope,
        audience_department=audience_department,
        audience_role=audience_role,
        effective_date=effective_date,
        is_required=is_required,
    )


def make_checklist(name="New Hire Checklist", description=None):
    return Checklist.objects.create(name=name, description=description)


def make_task(checklist, title="Sign the handbook", sort_order=0, resource=None):
    return Task.objects.create(checklist=checklist, title=title, sort_order=sort_order, resource=resource)
