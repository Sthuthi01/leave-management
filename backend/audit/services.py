from .models import AuditLogEntry


def log_audit(actor, action: str, target_type: str, target_label: str, details: str | None = None) -> None:
    """Record one audit entry. Call this only after the underlying business mutation has
    already succeeded — never before, and never for a request that failed validation or a
    permission/RBAC check. Where the call site already holds a transaction.atomic() block for
    the mutation itself, call this inside that same block so the audit write commits or rolls
    back atomically with the change it's recording, exactly like every other write in that
    transaction."""
    AuditLogEntry.objects.create(
        actor=actor,
        actor_name=actor.name,
        action=action,
        target_type=target_type,
        target_label=target_label,
        details=details,
    )
