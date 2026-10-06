import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Trip(models.Model):
    """A saved plan. The result is always produced by the server from `request`, never by the
    client, so a stored trip can't carry numbers the planner didn't compute."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trips")
    title = models.CharField(max_length=120)
    request = models.JSONField()
    result = models.JSONField()
    #: The few values the list view needs, so listing never loads a multi-hundred-KB `result`.
    summary = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["owner", "-created_at"], name="trips_owner_created_idx")]

    def __str__(self) -> str:
        return self.title
