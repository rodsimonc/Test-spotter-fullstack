from __future__ import annotations

import json
import uuid

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.common.errors import TripLimitReached, TripTooLarge
from apps.common.views import ApiView
from apps.planner import services
from apps.planner.serializers import build_request_data, request_data_to_dict

from .models import Trip
from .serializers import (
    PageSerializer,
    TripCreateSerializer,
    TripRenameSerializer,
    TripSerializer,
    TripSummarySerializer,
    build_summary,
    default_title,
)


class _TripView(ApiView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "trips"

    def owned_trips(self, request: Request):
        return Trip.objects.filter(owner=request.user)


class TripListCreateView(_TripView):
    def get(self, request: Request) -> Response:
        page = PageSerializer(data=request.query_params)
        page.is_valid(raise_exception=True)
        limit, offset = page.validated_data["limit"], page.validated_data["offset"]
        trips = self.owned_trips(request)
        rows = trips.defer("request", "result")[offset : offset + limit]
        return Response({"results": TripSummarySerializer(rows, many=True).data, "count": trips.count()})

    def post(self, request: Request) -> Response:
        body = TripCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)

        if self.owned_trips(request).count() >= settings.MAX_TRIPS_PER_USER:
            raise TripLimitReached(f"You've saved {settings.MAX_TRIPS_PER_USER} trips. Delete one to save another.")

        # The result is planned here, from the request alone. Nothing the client computed is kept.
        plan_request = build_request_data(body.validated_data["request"])
        result = services.plan_trip(plan_request)
        if len(json.dumps(result, separators=(",", ":")).encode()) > settings.MAX_TRIP_RESULT_BYTES:
            raise TripTooLarge

        trip = Trip.objects.create(
            owner=request.user,
            title=body.validated_data.get("title") or default_title(plan_request),
            request=request_data_to_dict(plan_request),
            result=result,
            summary=build_summary(plan_request, result),
        )
        return Response(TripSerializer(trip).data, status=status.HTTP_201_CREATED)


class TripDetailView(_TripView):
    def _trip(self, request: Request, pk: uuid.UUID) -> Trip:
        # Filtering by owner first means someone else's trip is a 404, never a 403 that would
        # confirm it exists.
        return get_object_or_404(self.owned_trips(request), pk=pk)

    def get(self, request: Request, pk: uuid.UUID) -> Response:
        return Response(TripSerializer(self._trip(request, pk)).data)

    def patch(self, request: Request, pk: uuid.UUID) -> Response:
        trip = self._trip(request, pk)
        body = TripRenameSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        trip.title = body.validated_data["title"]
        trip.save(update_fields=["title", "updated_at"])
        return Response(TripSerializer(trip).data)

    def delete(self, request: Request, pk: uuid.UUID) -> Response:
        self._trip(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
