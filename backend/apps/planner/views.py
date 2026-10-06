from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from apps.common.views import ApiView

from . import services
from .providers import photon
from .serializers import PlanRequestSerializer, ReverseQuerySerializer, SearchQuerySerializer


class HealthView(ApiView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class GeocodeSearchView(ApiView):
    permission_classes = [AllowAny]
    throttle_scope = "geocode_search"

    def get(self, request: Request) -> Response:
        query = SearchQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        found = photon.search(
            query.validated_data["q"],
            query.validated_data["limit"],
            query.validated_data.get("lat"),
            query.validated_data.get("lon"),
        )
        return Response({"results": found})


class GeocodeReverseView(ApiView):
    permission_classes = [AllowAny]
    throttle_scope = "geocode_reverse"

    def get(self, request: Request) -> Response:
        query = ReverseQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        place = services.reverse_geocode(query.validated_data["lat"], query.validated_data["lon"])
        return Response({"place": place})


class PlanView(ApiView):
    permission_classes = [AllowAny]
    throttle_scope = "plan"

    def post(self, request: Request) -> Response:
        body = PlanRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(services.plan_trip(body.to_request_data()))
