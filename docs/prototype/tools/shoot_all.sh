#!/bin/sh
# Regenerates every screenshot in docs/prototype/screenshots (needs network for the web fonts).
cd "$(dirname "$0")/.." || exit 1
S=screenshots
mkdir -p "$S"
shot() { ./shoot.sh "$1" "$S/$2.png" "${3:-1366}" "${4:-768}" && sips -s format jpeg -s formatOptions 82 "$S/$2.png" --out "$S/$2.jpg" >/dev/null && rm "$S/$2.png"; }
# Laptop 1366x768 - owner, French
shot "sell.html?shot&lang=fr&role=owner" 01-sell-fr-owner
shot "sell.html?shot&lang=fr&role=owner&open=undo" 02-sell-fr-owner-after-scan
shot "sell.html?shot&lang=fr&role=owner&open=line" 03-sell-fr-owner-line-selected
shot "sell.html?shot&lang=fr&role=owner&open=weight" 04-sell-fr-owner-weight-pad
shot "sell.html?shot&lang=fr&role=owner&open=pay" 05-sell-fr-owner-payment
shot "sell.html?shot&lang=fr&role=owner&open=sold" 06-sell-fr-owner-after-sale
shot "sell.html?shot&lang=fr&role=owner&open=kbd" 07-sell-fr-owner-touch-keyboard
shot "sell.html?shot&lang=fr&role=owner&open=void" 08-sell-fr-owner-void-dialog
shot "products.html?shot&lang=fr&role=owner" 09-products-fr-owner
shot "products.html?shot&lang=fr&role=owner&open=panel" 10-products-fr-owner-panel
shot "stock.html?shot&lang=fr&role=owner" 11-stock-receive-fr-owner
shot "stock-history.html?shot&lang=fr&role=owner" 12-stock-purchases-fr-owner
shot "stock-history.html?shot&lang=fr&role=owner&open=void" 13-stock-purchases-fr-owner-void-dialog
shot "reports.html?shot&lang=fr&role=owner" 14-reports-fr-owner
shot "reports.html?shot&lang=fr&role=owner&open=close" 15-reports-fr-owner-end-of-day
shot "clients.html?shot&lang=fr&role=owner" 16-clients-fr-owner
shot "settings.html?shot&lang=fr&role=owner" 17-settings-fr-owner-team
shot "settings.html?shot&lang=fr&role=owner&pane=device" 18-settings-fr-owner-device
# Laptop - cashier, French
shot "sell.html?shot&lang=fr&role=cashier" 19-sell-fr-cashier
shot "sell.html?shot&lang=fr&role=cashier&open=account" 20-sell-fr-cashier-account-menu
shot "sell.html?shot&lang=fr&role=cashier&open=price" 21-sell-fr-cashier-price-check
shot "sell.html?shot&lang=fr&role=cashier&net=offline&open=sync" 22-sell-fr-cashier-offline
shot "sell.html?shot&lang=fr&role=cashier&open=ticket" 23-sell-fr-cashier-ticket
shot "clients.html?shot&lang=fr&role=cashier&open=pay" 24-clients-fr-cashier-payment
shot "lock.html?shot&lang=fr" 25-lock-fr
shot "lock.html?shot&lang=fr&open=pin" 26-lock-fr-pin
# Laptop - Arabic (RTL)
shot "sell.html?shot&lang=ar&role=owner" 27-sell-ar-owner
shot "sell.html?shot&lang=ar&role=cashier" 28-sell-ar-cashier
shot "sell.html?shot&lang=ar&role=cashier&open=pay-credit" 29-sell-ar-cashier-credit-payment
shot "sell.html?shot&lang=ar&role=owner&open=kbd" 30-sell-ar-owner-touch-keyboard
shot "products.html?shot&lang=ar&role=owner&open=panel" 31-products-ar-owner-panel
shot "stock.html?shot&lang=ar&role=owner" 32-stock-receive-ar-owner
shot "stock-history.html?shot&lang=ar&role=owner" 33-stock-purchases-ar-owner
shot "reports.html?shot&lang=ar&role=owner" 34-reports-ar-owner
shot "clients.html?shot&lang=ar&role=owner" 35-clients-ar-owner
shot "clients.html?shot&lang=ar&role=cashier" 36-clients-ar-cashier
shot "settings.html?shot&lang=ar&role=owner" 37-settings-ar-owner
shot "lock.html?shot&lang=ar&open=pin" 38-lock-ar-pin
# Android tablet 1280x800
shot "sell-tablet.html?shot&lang=fr&role=cashier" 39-tablet-sell-fr-cashier 1280 800
shot "sell-tablet.html?shot&lang=ar&role=cashier" 40-tablet-sell-ar-cashier 1280 800
shot "sell-tablet.html?shot&lang=fr&role=owner&open=weight" 41-tablet-sell-fr-owner-weight-pad 1280 800
# 1920x1080 laptop at 125 % scaling = 1536x864 CSS px
shot "sell.html?shot&lang=fr&role=owner&device=laptop-lg" 42-sell-fr-owner-1920-at-125 1536 864
shot "reports.html?shot&lang=fr&role=owner&device=laptop-lg" 43-reports-fr-owner-1920-at-125 1536 864
# 1920x1080 laptop at 150 % scaling = 1280x720 CSS px (minimum supported)
shot "sell.html?shot&lang=fr&role=owner&device=laptop-sm" 44-sell-fr-owner-1920-at-150 1280 720
