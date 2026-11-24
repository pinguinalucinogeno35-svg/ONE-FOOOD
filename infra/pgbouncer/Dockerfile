FROM alpine:3.21
RUN apk add --no-cache pgbouncer && addgroup -S pgb && adduser -S -G pgb pgb
COPY pgbouncer.ini userlist.txt /etc/pgbouncer/
USER pgb
EXPOSE 6432
CMD ["pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
