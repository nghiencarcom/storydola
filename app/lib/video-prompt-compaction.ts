/** Shared policy metadata, kept separate from the actual edits to each saved scene. */
export type VideoPromptEdit = { before: string; after: string; reason: string };
export type VideoPromptCompactionReport = {
  limit: number;
  templateEdits: VideoPromptEdit[];
  sceneEdits: VideoPromptEdit[];
  omittedSections: string[];
  recommendations: string[];
};

export function videoPromptCompactionReport(_aiDrama: boolean, limit = 5_000): VideoPromptCompactionReport {
  return {
    limit,
    templateEdits: [
      { before: 'Fixed camera grid; mandatory opening hold 0.5s; reframing every ≤3s.', after: 'Natural pacing for 5/10/15s; continuous shots allowed; motion may begin immediately.', reason: 'Bỏ quy tắc nhịp cứng, không tự thay timecode thoại/SFX/VFX hay hành động.' },
      { before: 'Concrete age/facial descriptions alongside reference images.', after: 'REFERENCE RULES bind face, apparent age, skin tone, hair, proportions and costume to the images; no de-aging or recasting.', reason: 'Giữ đầy đủ quy tắc khoá theo ảnh; chỉ cấm mô tả tuổi/đặc điểm khuôn mặt cụ thể. Biểu cảm, diễn xuất và hướng nhìn vẫn được phép.' },
      { before: 'Repeated camera execution and lip-sync boilerplate.', after: 'One shared execution section and one dialogue timeline header.', reason: 'Gom hướng dẫn trùng; giữ đường camera, hiệu ứng và timing cần thiết.' },
      { before: 'Maintain it throughout the clip and match any supplied scene frame.', after: 'match scene frame throughout.', reason: 'Chỉ rút gọn câu hướng dẫn lặp; không ép giảm số ký tự nếu còn dưới trần.' },
    ],
    sceneEdits: [],
    omittedSections: [],
    recommendations: [
      'Giữ tổng thời lượng 5/10/15 giây, không ép chia đều nhịp hay giữ hình đầu. Các timecode hiện có không tự động trở thành điểm cắt.',
      'Giữ camera, VFX, lời thoại, thời điểm sự kiện và chi tiết nhân quả trong giới hạn model; nếu vượt trần, tự động cắt phần cuối prompt.',
      'Dùng giới hạn ký tự theo model trong catalog. Nếu prompt vượt giới hạn, hệ thống tự cắt phần cuối trước khi gửi API.',
      'Với ảnh nhân vật, cấm mô tả tuổi/đặc điểm khuôn mặt cụ thể; giữ nguyên REFERENCE RULES khoá nhân vật và bối cảnh theo ảnh, cùng diễn xuất/hướng nhìn.',
    ],
  };
}
