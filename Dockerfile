# Builder
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ARG VERSION
ENV VERSION=$VERSION

RUN npm run build


# Runner
FROM nginx:alpine

WORKDIR /usr/share/nginx/html

RUN rm -rf ./*

COPY --from=builder /app/dist/ ./

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]