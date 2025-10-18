# Heliactyl • The modern client panel for Pterodactyl

![GitHub commit](https://img.shields.io/github/last-commit/OvernodeProjets/fixed-heliactyl-next) ![GitHub Release](https://img.shields.io/github/v/release/OvernodeProjets/fixed-heliactyl-next) ![GitHub issues](https://img.shields.io/github/issues/OvernodeProjets/fixed-heliactyl-next) ![GitHub license](https://img.shields.io/github/license/OvernodeProjets/fixed-heliactyl-next)

> [!WARNING]  
> Heliactyl 19 is not compatible with `settings.json` files. You can keep the same `database.sqlite / heliactyl.db` though without having any issues.

Heliactyl is a high-performance client area for the Pterodactyl Panel. It allows your users to create, edit and delete servers, and also earn coins which can be used to upgrade their servers.

## Get started

You can get started straight away by following these steps:

1. Clone the repo: Run `git clone https://github.com/OvernodeProjets/fixed-heliactyl-next.git` on your machine
2. Enter the directory and configure the `config_example.toml` file - most are optional except the Pterodactyl API
3. Check everything out and make sure you've configured Heliactyl correctly
4. Create SSL certificates for your target domain and set up the NGINX reverse proxy

## NGINX Reverse Proxy

You can either use a single domain setup or a split domain setup (recommended for production).

### Single Domain Setup
Basic configuration for a single domain:

```nginx
server {
    listen 80;
    server_name <domain>;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <domain>;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers  HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location /ws {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass "http://localhost:<port>/ws";
    }

    location / {
        proxy_pass http://localhost:<port>/;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Split Domain Setup (Recommended)
For a production environment, we recommend splitting your website and dashboard into separate domains:

1. Main website configuration (e.g., yourdomain.com):
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers  HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Redirect dashboard routes to dashboard domain
    location /auth {
        return 301 https://dashboard.yourdomain.com/auth;
    }
    
    location /dashboard {
        return 301 https://dashboard.yourdomain.com/dashboard;
    }

    # Serve only homepage and static assets
    location / {
        proxy_pass http://localhost:<port>/website;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $host;
        proxy_set_header X-Website-Only "true";
    }

    location /assets {
        proxy_pass http://localhost:<port>/assets;
        proxy_buffering off;
    }
}
```

2. Dashboard configuration (e.g., dashboard.yourdomain.com):
```nginx
server {
    listen 80;
    server_name dashboard.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dashboard.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/dashboard.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.yourdomain.com/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers  HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # WebSocket support
    location /ws {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass "http://localhost:<port>/ws";
    }

    # Redirect root to auth page
    location = / {
        return 301 https://dashboard.yourdomain.com/auth;
    }

    # Block access to website page on dashboard domain
    location /website {
        return 404;
    }

    location / {
        proxy_pass http://localhost:<port>;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Dashboard-Only "true";
    }
}
```

3. Update your config.toml:
```toml
[website]
port = 3000
domain = "https://dashboard.yourdomain.com"  # Dashboard domain
```

Make sure to:
1. Replace <port> with your Heliactyl port (default: 3000)
2. Replace yourdomain.com with your actual domain
3. Generate SSL certificates for both domains
4. Create separate nginx config files for each domain
5. Enable the configurations and restart nginx
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
Copyright (c) 2022 - 2025 Overnode