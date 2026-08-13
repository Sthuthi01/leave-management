#!/bin/sh
set -e

# Only ever runs migrations — bootstrap_admin is intentionally NOT invoked here, or anywhere else
# automatically. It's a management command the developer runs by hand (see README), matching the
# safety guarantee of the original scripts/bootstrap-admin.ts: never something that fires on
# container start, in any environment.
python manage.py migrate --noinput

exec "$@"
