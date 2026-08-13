from django.contrib import admin

from .models import Checklist, Resource, ResourceAttachment, ResourceDocument, ResourceVersion, Task, TaskCompletion

admin.site.register(Resource)
admin.site.register(ResourceDocument)
admin.site.register(ResourceAttachment)
admin.site.register(ResourceVersion)
admin.site.register(Checklist)
admin.site.register(Task)
admin.site.register(TaskCompletion)
