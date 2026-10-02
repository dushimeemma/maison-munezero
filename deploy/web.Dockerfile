# Build Flutter with the tested SDK before constructing this image.
FROM nginx:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/flutter/build/web /usr/share/nginx/html
EXPOSE 8080
