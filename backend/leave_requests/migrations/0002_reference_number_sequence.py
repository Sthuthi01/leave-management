from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("leave_requests", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql="CREATE SEQUENCE IF NOT EXISTS leave_request_seq;",
            reverse_sql="DROP SEQUENCE IF EXISTS leave_request_seq;",
        ),
    ]
