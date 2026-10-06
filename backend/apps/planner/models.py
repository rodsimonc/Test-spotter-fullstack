from django.db import models
from django.utils import timezone


class RouteCache(models.Model):
    """A routing answer, keyed by the three rounded waypoints it was asked for.

    Public OSRM is slow and rate limited, and planning then saving the same trip would otherwise
    route it twice.
    """

    key = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    def __str__(self) -> str:
        return f"route {self.key[:12]}"
