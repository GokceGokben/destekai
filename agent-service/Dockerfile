FROM python:3.13-slim
RUN pip install --no-cache-dir uv==0.11.14
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
RUN useradd --uid 10001 --no-create-home app
USER app
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
ENTRYPOINT ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000"]
