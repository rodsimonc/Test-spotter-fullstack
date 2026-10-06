"""JSON body parsing with a hard size limit."""

from __future__ import annotations

import io

from django.conf import settings
from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser

from .errors import PayloadTooLarge


class BoundedJSONParser(JSONParser):
    """Reads at most `DATA_UPLOAD_MAX_MEMORY_SIZE` bytes before parsing.

    DRF reads the request stream directly, so Django's own body size setting never applies to
    it. NaN and Infinity literals are already rejected by DRF's JSONParser.
    """

    def parse(self, stream, media_type=None, parser_context=None):
        limit = settings.DATA_UPLOAD_MAX_MEMORY_SIZE
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise PayloadTooLarge.for_limit(limit)
        try:
            return super().parse(io.BytesIO(raw), media_type, parser_context)
        except RecursionError:
            # 30,000 opening brackets fit in 64 KB and overflow the decoder's stack.
            raise ParseError("JSON parse error - nested too deeply.") from None
