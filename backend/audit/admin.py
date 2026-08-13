from django.contrib import admin

from .models import AuditLogEntry

admin.site.register(AuditLogEntry)
