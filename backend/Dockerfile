FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# libpq is needed at runtime for psycopg (even the [binary] wheel needs the client lib present on
# some base images) and curl for the HEALTHCHECK below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bakes Django admin's static assets (CSS/JS) into the image so /admin/ renders correctly in every
# environment — WhiteNoise serves STATIC_ROOT directly from gunicorn at runtime (see settings.py).
# The env vars here are build-time-only placeholders, just enough for settings.py to import without
# ImproperlyConfigured (collectstatic never opens a DB connection or uses the secret key's value) —
# real values always come from the container's actual runtime environment, which overrides these.
RUN DJANGO_SECRET_KEY=collectstatic-build-placeholder \
    DJANGO_DATABASE_URL=postgres://placeholder:placeholder@localhost/placeholder \
    python manage.py collectstatic --noinput

# Created explicitly (not left for Django to lazily create at first upload) so it exists in the
# image with the right ownership before the chown below — a named volume mounted here at runtime
# is populated from this image path on first creation, inheriting this ownership; without this,
# Docker creates the volume's mount point owned by root, and the non-root `django` user below
# gets a PermissionError the first time anyone uploads an onboarding document.
RUN mkdir -p /app/media

RUN addgroup --system django && adduser --system --ingroup django django \
    && chown -R django:django /app
USER django

RUN chmod +x entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/health/ || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
