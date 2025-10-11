# Heliactyl

![GitHub commit](https://img.shields.io/github/last-commit/heliactyloss/heliactyl) ![GitHub Release](https://img.shields.io/github/v/release/heliactyloss/heliactyl)

> [!WARNING]  
> Heliactyl 19 is not compatible with `settings.json` files. You can keep the same `database.sqlite / heliactyl.db` though without having any issues.

Heliactyl is a high-performance client area for the Pterodactyl Panel. It allows your users to create, edit and delete servers, and also earn coins which can be used to upgrade their servers.

## Get started

You can get started straight away by following these steps:

1. Clone the repo: Run `git clone https://github.com/heliactyloss/heliactyl` on your machine
2. Enter the directory and configure the `settings.json` file - most are optional except the Pterodactyl and OAuth2 settings which **must** be configured
3. Check everything out and make sure you've configured Heliactyl correctly
4. Create SSL certificates for your target domain and set up the NGINX reverse proxy

## NGINX Reverse Proxy

Here's a proxy config that we recommend, however you are free to change it:

```nginx
server {
    listen 80;
    server_name <domain>;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;

    location /ws {
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_pass "http://localhost:<port>/ws";
    }

    server_name <domain>;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers  HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
      proxy_pass http://localhost:<port>/;
      proxy_buffering off;
      proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Development Tools

These commands are available:
```
npm run start - starts Heliactyl
npm run build:css - builds TailwindCSS, required for making changes to the UI
```

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
Copyright (c) 2017 - 2025 Altare Technologies Inc