"""News Router."""

from fastapi import APIRouter, Query

from ..schemas import NewsResponse

router = APIRouter(prefix="/api/news", tags=["News"])


@router.get("/{company_name}", response_model=NewsResponse)
async def get_news(
    company_name: str,
    num_articles: int = Query(default=5, le=20)
):
    """Return the public news contract.

    The previous news engine was removed with the legacy API pipeline. Company
    context now comes from JobLens company intelligence.
    """

    _ = num_articles
    return NewsResponse(company_name=company_name, articles=[], total_results=0)
