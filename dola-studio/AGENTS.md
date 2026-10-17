# Dola workspace rules

## Development and UI verification

- Khi chỉnh sửa code hoặc kiểm tra UI, chỉ chạy `npm run dev`.
- Không chạy `npm start` hoặc `npm run start:studio` trong workflow phát triển. Các lệnh production có thể thay listener đang phục vụ UI bằng bản build cũ và làm gián đoạn người dùng.
- Chỉ dùng lệnh production cho triển khai hoặc khi người dùng yêu cầu rõ ràng; sau khi chỉnh sửa, giữ ứng dụng chạy bằng launcher dev.
- Có thể chạy `npm run lint` và các kiểm tra phù hợp để xác minh code, nhưng không dùng chúng để thay thế launcher dev khi kiểm tra UI.
