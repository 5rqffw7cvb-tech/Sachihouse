FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=http://localhost:3001/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
# The build container has no backend to fetch properties/blog posts from, so
# prebuild's sitemap generation always falls back to the committed
# public/sitemap.xml here. SITEMAP_STRICT=0 keeps that fallback from failing
# the build; a real deploy pipeline with API access can pass
# `--build-arg SITEMAP_STRICT=1` to fail the build instead if the fetch fails,
# rather than silently shipping the committed fallback.
ARG SITEMAP_STRICT=0
ENV SITEMAP_STRICT=${SITEMAP_STRICT}
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=8080
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
