FROM nginx:1.27-alpine

RUN apk add --no-cache curl

# Xóa các cấu hình mặc định ban đầu
RUN rm -rf /etc/nginx/conf.d/*

# Nạp các tệp cấu hình chuyên dụng
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/conf.d/app.conf /etc/nginx/conf.d/app.conf
COPY docker/nginx/conf.d/ssl.conf.template /etc/nginx/conf.d/ssl.conf.template

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
