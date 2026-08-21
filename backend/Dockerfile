# syntax=docker/dockerfile:1

# Thin FastAPI ingress-proxy for the WaCRM (Next.js) app.
#
# Some ingress setups (e.g. the Emergent/Kubernetes ingress used for
# whatsapp.stepsolar.in) route every /api/* request to a separate port.
# Next.js serves its own API routes, so this proxy simply forwards
# /api/* -> http://frontend:3000 (NEXT_ORIGIN). Anything not under
# /api goes straight to the frontend container.

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./

ENV NEXT_ORIGIN=http://frontend:3000

EXPOSE 8001

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
