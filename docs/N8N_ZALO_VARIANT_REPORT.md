# n8n: Gửi báo cáo bán chạy vào nhóm Zalo (Bot API)

Luồng: **Cron (n8n)** → **MeiT-Tools API** → **Zalo Bot `sendMessage`**.

Tài liệu Zalo Bot: [setWebhook](https://bot.zapps.me/docs/apis/setWebhook/) (chỉ cần khi bot *nhận* lệnh; báo cáo một chiều dùng `sendMessage`).

## 1. API báo cáo (MeiT-Tools)

```
GET {PUBLIC_BASE}/pancake-webhook/analytics/variant-sales/zalo-text?days=7&limit=15&eventLimit=1000
```

| Query | Mặc định | Mô tả |
|-------|----------|--------|
| `days` | 7 | Số ngày thống kê |
| `limit` | 15 | Số dòng tối đa trong tin nhắn (max 50) |
| `eventLimit` | 500 | Số webhook đọc từ Mongo |
| `secret` | — | Bắt buộc nếu server có `ZALO_REPORT_SECRET` |

**Response:**

```json
{
  "ok": true,
  "windowDays": 7,
  "variantCount": 77,
  "lineCount": 15,
  "text": "📊 Biến thể bán chạy (7 ngày)\n..."
}
```

Dùng `{{ $json.text }}` trong n8n làm nội dung gửi Zalo.

**Ví dụ production:**

```
https://pancake-automation-server-production.up.railway.app/pancake-webhook/analytics/variant-sales/zalo-text?days=7&limit=15
```

Tùy chọn bảo vệ trên Railway `.env`:

```env
ZALO_REPORT_SECRET=your-long-random-secret
```

Thêm query `&secret=your-long-random-secret` hoặc header `X-Report-Secret`.

## 2. Zalo Bot (một lần)

1. Tạo bot tại [Zalo Bot Platform](https://bot.zapps.me).
2. **Thêm bot vào nhóm Zalo** cần nhận báo cáo.
3. Lấy **BOT_TOKEN** và **chat_id** của nhóm:
   - Gọi `getUpdates` sau khi có tin trong nhóm, hoặc
   - Bật webhook tạm để xem `chat.id` trong payload.
4. Lưu token + chat_id trong **n8n Credentials** (không commit git).

**Gửi tin:** `POST https://bot-api.zaloplatforms.com/bot{BOT_TOKEN}/sendMessage`  
Body (JSON): `chat_id`, `text` — xem [sendMessage](https://bot.zapps.me/docs/apis/sendMessage/) trên cùng site.

## 3. Workflow n8n (gợi ý)

### Node 1 — Schedule Trigger

- Cron: `0 8 * * *` (8:00 mỗi ngày) hoặc tùy giờ.

### Node 2 — HTTP Request (báo cáo)

- Method: `GET`
- URL: URL API ở mục 1 (kèm `secret` nếu có).
- Response: JSON.

### Node 3 — HTTP Request (Zalo sendMessage)

- Method: `POST`
- URL: `https://bot-api.zaloplatforms.com/bot<YOUR_BOT_TOKEN>/sendMessage`
- Body (JSON):

```json
{
  "chat_id": "<GROUP_CHAT_ID>",
  "text": "={{ $('HTTP Request').item.json.text }}"
}
```

(Đổi tên node HTTP Request cho đúng tên trong workflow.)

### Node 4 (tuỳ chọn) — IF lỗi

- Nếu `ok !== true` hoặc Zalo trả lỗi → gửi email / Telegram ops.

## 4. Kiểm tra tay

1. Mở URL `zalo-text` trên trình duyệt → thấy `text` hợp lý.
2. Chạy workflow **Execute workflow** một lần.
3. Kiểm tra tin trong nhóm Zalo.

## 5. Không cần setWebhook cho báo cáo định kỳ

`setWebhook` chỉ dùng khi bot **nhận** tin từ người dùng (ví dụ lệnh `/baochay`). Báo cáo push chỉ cần **sendMessage**.
