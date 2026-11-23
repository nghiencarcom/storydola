import type { VideoGenerationModelOption } from "./project-types";

export const salesVideoTemplates = [
  { id: "general", name: "Mọi sản phẩm", direction: "Giới thiệu sản phẩm trực diện, xen cảnh cận để người xem nhận ra hình dáng và bao bì." },
  { id: "fashion", name: "Thời trang", direction: "Cho người mẫu mặc trang phục tham chiếu, quay toàn thân rồi cận chất liệu và đường may." },
  { id: "home", name: "Gia dụng", direction: "Đặt sản phẩm trong không gian gia đình và minh họa một thao tác sử dụng thực tế." },
  { id: "snacks", name: "Đồ ăn vặt", direction: "Làm nổi bật bao bì, mở gói tự nhiên và quay cận kết cấu đồ ăn nếu có thể xác định từ ảnh." },
  { id: "consumer", name: "Hàng tiêu dùng", direction: "Cho thấy sản phẩm trong một tình huống sử dụng hằng ngày, làm rõ quy cách và nhãn." },
  { id: "beauty", name: "Mỹ phẩm", direction: "Quay cận bao bì rồi minh họa cách cầm hoặc sử dụng theo loại sản phẩm. Tránh cảnh trước và sau." },
  { id: "baby", name: "Mẹ và bé", direction: "Người lớn giới thiệu sản phẩm trong không gian sáng, làm rõ kích thước và các chi tiết nhìn thấy." },
  { id: "tech", name: "Đồ công nghệ", direction: "Quay cận thiết kế rồi minh họa thao tác cơ bản có thể suy ra từ ảnh. Không dựng thông số kỹ thuật." },
  { id: "accessories", name: "Phụ kiện thời trang", direction: "Phối sản phẩm với trang phục đơn giản. Quay cận cách đeo và chi tiết nhận diện." },
  { id: "footwear", name: "Giày dép", direction: "Quay ngang một bước đi ngắn, rồi cận thân và đế giày. Giữ màu và hình dáng." },
  { id: "decor", name: "Đồ trang trí", direction: "Bố trí sản phẩm trong nội thất phù hợp, chuyển từ toàn cảnh sang chi tiết bề mặt." },
  { id: "school", name: "Đồ dùng học tập", direction: "Quay sản phẩm trên bàn học và minh họa một thao tác đơn giản." },
  { id: "supplements", name: "Thực phẩm bổ sung", direction: "Giới thiệu bao bì và tên sản phẩm. Không nêu liều lượng, hiệu quả sức khỏe hay công dụng điều trị." },
  { id: "toys", name: "Đồ chơi", direction: "Người mẫu thao tác nhẹ nhàng với đồ chơi, quay rõ màu sắc và những bộ phận nhìn thấy trong ảnh." },
  { id: "vehicles", name: "Xe cộ", direction: "Quay ngoại thất và chi tiết nhìn thấy, đặt người giới thiệu cạnh xe. Không dựng thông số hoặc cảnh lái nguy hiểm." },
  { id: "pets", name: "Phụ kiện thú cưng", direction: "Minh họa vị trí đặt hoặc cách cầm sản phẩm trong góc sinh hoạt của thú cưng." },
];

export const salesVideoDurations = [10, 15, 20, 25, 30, 45, 60] as const;
export const salesVideoRatios = ["9:16", "16:9"] as const;
export const salesVideoContentStyles = [
  { id: "problem-solution", label: "Hỏi vấn đề – đáp giải pháp", framework: "PAS · Problem – Agitate – Solution", uiSummary: "Một người hỏi nêu rắc rối thật → người dẫn làm rõ bất tiện → đưa giải pháp có căn cứ. Chỉ kiểu này dùng hai vai; nếu có một ảnh nhân vật, người hỏi ở ngoài khung hình.", guidance: "Mở bằng một người hỏi nêu vấn đề đời thường; làm rõ bất tiện bằng một câu ngắn rồi người giới thiệu đưa giải pháp, minh họa một tính năng có căn cứ và nêu giới hạn phù hợp. Giữ hội thoại tự nhiên, không xúc phạm hay hù dọa." },
  { id: "review", label: "Review / đánh giá cân bằng", framework: "BAB · Before – After – Bridge", uiSummary: "Tình huống ban đầu → điều muốn cải thiện → trải nghiệm thật → nhận xét cân bằng. Nếu chưa có trải nghiệm, kể theo tình huống giả định và không nhận đã dùng.", guidance: "Kể từ tình huống trước khi dùng, điều người dùng muốn cải thiện, rồi nối sang trải nghiệm/đánh giá thực tế và điểm cần cân nhắc. Chỉ khẳng định kết quả sau khi dùng nếu có ghi chép trải nghiệm thật; nếu chưa có, dùng tình huống giả định có điều kiện, không giả làm khách hàng." },
  { id: "how-to", label: "Hướng dẫn sử dụng", framework: "FAB · Feature – Advantage – Benefit", uiSummary: "Tính năng đã xác minh → thao tác/lợi thế → ích lợi trong tình huống cụ thể. Chỉ hướng dẫn bước có căn cứ và minh họa được.", guidance: "Với mỗi bước, nối tính năng đã xác minh với lợi thế thao tác và lợi ích cụ thể cho người dùng. Người dẫn vừa nói vừa minh họa đúng thao tác; không bịa hướng dẫn hoặc hiệu quả." },
  { id: "before-buy", label: "Cân nhắc trước khi mua", framework: "AIDA · Attention – Interest – Desire – Action", uiSummary: "Nhu cầu → thông tin liên quan → ai có thể thấy phù hợp → điều cần kiểm tra và lời mời cân nhắc nhẹ.", guidance: "Thu hút bằng một nhu cầu thật, giúp người xem hiểu điểm liên quan, gợi hình dung sản phẩm phù hợp với ai và kết bằng lời mời kiểm tra/so sánh nhẹ nhàng. Nêu cả điều kiện cần cân nhắc, không gây áp lực mua." },
  { id: "after-buy", label: "Mở hộp / ấn tượng ban đầu", framework: "PPP · Promise – Picture – Proof", uiSummary: "Kỳ vọng có căn cứ → chi tiết mở hộp/bắt đầu dùng nhìn thấy → bằng chứng từ nguồn hoặc trải nghiệm đã nhập. Chưa có trải nghiệm thì không gọi là review sau mua.", guidance: "Nêu kỳ vọng có căn cứ, mô tả khoảnh khắc mở hộp/bắt đầu sử dụng rồi đưa bằng chứng nhìn thấy hoặc trải nghiệm thật người dùng đã cung cấp. Nếu chưa có trải nghiệm, chỉ gọi đó là mở hộp/ấn tượng ban đầu; không tự nhận đã mua hoặc dùng." },
  { id: "comparison", label: "So sánh theo tiêu chí", framework: "4P · Promise – Picture – Proof – Push", uiSummary: "Giá trị → tình huống dùng → bằng chứng/tiêu chí chung → để người xem tự chọn theo nhu cầu. Không tự dựng đối thủ hoặc số liệu.", guidance: "Đặt lời hứa giá trị có căn cứ, hình dung tình huống sử dụng, đưa bằng chứng/tiêu chí kiểm tra rồi kết bằng lời mời chọn theo nhu cầu. Chỉ so sánh đối thủ khi có dữ liệu cùng tiêu chí; nếu thiếu, không kết luận thắng thua." },
] as const;
export const salesVideoClaimCategories = [
  { id: "general", label: "Thông tin sản phẩm thông thường" },
  { id: "health", label: "Sức khỏe / chăm sóc sức khỏe" },
  { id: "finance", label: "Tài chính / đầu tư" },
] as const;
export type SalesVideoContentStyle = typeof salesVideoContentStyles[number]["id"];
export type SalesVideoClaimCategory = typeof salesVideoClaimCategories[number]["id"];

export function salesVideoContentStyleGuidance(id: string) {
  return salesVideoContentStyles.find((style) => style.id === id)?.guidance || salesVideoContentStyles[0].guidance;
}

export function salesVideoContentFramework(id: string) {
  return salesVideoContentStyles.find((style) => style.id === id)?.framework || salesVideoContentStyles[0].framework;
}

export function salesVideoScriptStyleGuidance(id: string) {
  if (id === "problem-solution") {
    return "DÙNG PAS VÀ HỎI ĐÁP HAI VAI: Người hỏi ở ngoài khung hình nêu Problem, có thể nhấn nhẹ Agitate bằng hệ quả đời thường; người trả lời là nhân vật trong ảnh, đưa Solution bằng thông tin đã xác minh và minh họa. Kết bằng lưu ý/CTA ngắn. Mỗi lượt trên một dòng riêng, gắn nhãn ‘Người hỏi (ngoài khung hình):’ hoặc ‘Người trả lời:’. Không tạo thêm khuôn mặt.";
  }
  const instructions: Record<string, string> = {
    review: "DÙNG BAB VÀ MỘT NGƯỜI DẪN: Đi từ tình huống trước khi dùng → thay đổi mong muốn → trải nghiệm thật làm cầu nối, kèm nhận xét cân bằng. Nếu chưa có trải nghiệm do người dùng nhập, chuyển thành tình huống giả định (‘nếu bạn…’) và đánh giá tính năng/điểm cần cân nhắc; tuyệt đối không tự xưng đã dùng hoặc khẳng định kết quả. Không hỏi đáp, không gắn nhãn vai.",
    "how-to": "DÙNG FAB VÀ MỘT NGƯỜI DẪN: Hướng dẫn từng bước ngắn; nói tính năng nào được dùng, thao tác đó có lợi thế gì và giúp ích gì trong tình huống cụ thể. Chỉ hướng dẫn thao tác có căn cứ. Không hỏi đáp, không gắn nhãn vai.",
    "before-buy": "DÙNG AIDA VÀ MỘT NGƯỜI DẪN: Hook vào nhu cầu → giải thích điều liên quan → giúp người xem tự hình dung độ phù hợp dựa trên nguồn → CTA nhẹ để kiểm tra/so sánh. Nêu một điều cần cân nhắc, không gây áp lực. Không hỏi đáp, không gắn nhãn vai.",
    "after-buy": "DÙNG PPP VÀ MỘT NGƯỜI DẪN: Nêu kỳ vọng có căn cứ → mô tả cảnh mở hộp/bắt đầu dùng → đưa bằng chứng từ ảnh, nguồn hoặc trải nghiệm người dùng nhập. Nếu không có trải nghiệm, gọi đúng là mở hộp/ấn tượng ban đầu, không nhận đã mua/dùng hay tự bịa kết quả. Không hỏi đáp, không gắn nhãn vai.",
    comparison: "DÙNG 4P VÀ MỘT NGƯỜI DẪN: Nêu giá trị có căn cứ → dựng tình huống sử dụng → đưa bằng chứng/tiêu chí đối chiếu → kết bằng lời mời chọn theo nhu cầu. Không bịa đối thủ, dữ liệu hoặc kết luận thắng thua; thiếu dữ liệu thì hướng dẫn người xem tự kiểm tra cùng tiêu chí. Không hỏi đáp, không gắn nhãn vai.",
  };
  return instructions[id] || instructions.review;
}

export function salesVideoScriptPlaceholder(id: string) {
  const examples: Record<string, string> = {
    "problem-solution": "Người hỏi (ngoài khung hình): Mình đang gặp [vấn đề], sản phẩm này giúp gì được không?\nNgười trả lời: Đây, mình chỉ bạn [tính năng/cách dùng đã xác minh].",
    review: "Điều đầu tiên mình chú ý ở [tên sản phẩm] là [chi tiết có thật]. Điểm này phù hợp nếu bạn cần [nhu cầu]; nhớ cân nhắc [điều cần lưu ý].",
    "how-to": "Để dùng [tên sản phẩm], trước tiên [bước 1]. Sau đó [bước 2]. Đây là thao tác cần chú ý: [lưu ý đã xác minh].",
    "before-buy": "Nếu bạn đang cân nhắc [tên sản phẩm], hãy kiểm tra [tiêu chí phù hợp]. Sản phẩm có [thông tin đã xác minh]; cân nhắc thêm [điều kiện hoặc giới hạn].",
    "after-buy": "Mở hộp [tên sản phẩm] cùng mình nhé. Đây là những gì có trong hộp: [chi tiết nhìn thấy]. Để bắt đầu, [bước sử dụng đã xác minh].",
    comparison: "Khi so sánh [tên sản phẩm], hãy nhìn vào [tiêu chí 1] và [tiêu chí 2]. Theo thông tin hiện có, sản phẩm có [dữ kiện]; hãy đối chiếu cùng tiêu chí với lựa chọn khác.",
  };
  return examples[id] || examples["problem-solution"];
}

export function salesVideoClaimGuidance(category: string, templateId = "") {
  const effectiveCategory = templateId === "supplements" ? "health" : category;
  const sensitiveTemplateGuidance = {
    beauty: "NGÀNH MỸ PHẨM NHẠY CẢM: Không khẳng định chữa khỏi/điều trị dứt điểm, cam kết 100%, tốt nhất thị trường, số 1, trắng bật tông sau vài ngày hoặc kết quả chắc chắn. Chỉ mô tả đặc tính/cảm giác có căn cứ; không bịa trải nghiệm cá nhân hay kết quả trước–sau.",
    baby: "NGÀNH MẸ VÀ BÉ NHẠY CẢM: Không nói an toàn tuyệt đối, phù hợp mọi trẻ, cam kết 100% hay hứa hẹn kết quả sức khỏe/phát triển nếu không có căn cứ. Nêu đúng độ tuổi, hướng dẫn và cảnh báo nhìn thấy trên nhãn; không tạo cảnh trẻ thiếu giám sát.",
    supplements: "THỰC PHẨM BỔ SUNG NHẠY CẢM: Không claim chữa/điều trị/phòng bệnh, giảm cân cấp tốc, cam kết 100%, tốt nhất thị trường, số 1 hoặc hiệu quả chắc chắn. Chỉ dùng ‘hỗ trợ’ đúng công dụng có căn cứ trên nhãn/tài liệu; không bịa trải nghiệm hoặc tự thêm liều dùng.",
  }[templateId as "beauty" | "baby" | "supplements"] || "";
  if (effectiveCategory === "health") return ["AN TOÀN SỨC KHỎE: Chỉ nêu công dụng sức khỏe đúng theo nhãn/tài liệu hoặc nguồn đã xác minh; chỉ dùng từ ‘hỗ trợ’ khi chính công dụng đó có căn cứ. Không chẩn đoán, chữa/điều trị/phòng bệnh, hứa kết quả, khuyên ngừng thuốc hoặc bịa trải nghiệm trước–sau. Nếu thiếu căn cứ, chỉ mô tả bao bì và thông tin nhìn thấy, không suy đoán.", sensitiveTemplateGuidance].filter(Boolean).join(" ");
  if (effectiveCategory === "finance") return ["AN TOÀN TÀI CHÍNH: Chỉ mô tả tính năng, điều kiện, phí và rủi ro có nguồn. Không hứa lợi nhuận, nói không rủi ro, khuyên cá nhân mua/đầu tư hoặc tạo khẩn cấp giả. Có thể nói đây là thông tin chung, không phải lời khuyên tài chính/đầu tư cá nhân; câu miễn trừ không thay thế việc nêu đúng rủi ro.", sensitiveTemplateGuidance].filter(Boolean).join(" ");
  return ["TÍNH TRUNG THỰC: Không giả làm khách hàng đã mua/dùng, không bịa đánh giá, kết quả, số liệu, chứng nhận hay độ phổ biến. Dùng lời nói tự nhiên, dí dỏm vừa phải và tôn trọng người xem.", sensitiveTemplateGuidance].filter(Boolean).join(" ");
}

export const salesVideoLanguages = [
  "Tiếng Việt", "English", "ไทย", "한국어", "日本語", "Deutsch", "Français", "Italiano",
  "Русский", "粵語", "Español", "فارسی", "中文", "Português", "Tagalog", "Bahasa Indonesia",
  "हिन्दी", "বাংলা", "اردو", "Naijíriá Píjin",
] as const;
export const salesVideoImageTypes = ["image/png", "image/jpeg", "image/webp", "image/avif"];
export const salesVideoImageLimit = 50 * 1024 * 1024;
export const salesVideoMaxProductImages = 5;
export const salesVideoNameLimit = 5000;

export const salesVideoPromptDurations = [10, 15, 20, 25, 30] as const;
const photo = (label: string) => ({ name: "image-1", label, kind: "image" as const });
const photos = (count: number) => Array.from({ length: count }, (_, index) => ({
  name: `image-${index + 1}`, label: `Ảnh ${index + 1}`, kind: "image" as const,
}));
const audio = (label: string) => ({ name: "audio", label, kind: "audio" as const });

type CreativeTemplate = {
  id: string;
  name: string;
  files: { name: string; label: string; kind: "image" | "audio" | "video" }[];
  text?: string;
  defaultText?: string;
  defaultSeconds?: number;
  durations?: readonly number[];
  workflow: "prompt" | "audio" | "background" | "remake" | "poses" | "narration";
  instruction: string;
};

const poses = (count: number) => ({
  id: `poses-${count}`, name: `Tạo dáng và chuyển động · ${count} ảnh`,
  files: photos(count), defaultSeconds: Math.ceil(count / 2) * 5, durations: [Math.ceil(count / 2) * 5], workflow: "poses" as const,
  instruction: "Tạo một đoạn video dài đúng 5 giây cho mỗi cặp ảnh liên tiếp. Dùng hai ảnh trong cặp làm góc tham chiếu của cùng người mẫu; giữ nguyên khuôn mặt, tóc, trang phục và sản phẩm. Chuyển động tạo dáng nhẹ, tự nhiên, không đổi người hoặc đổi đồ. Ghép các đoạn 5 giây theo thứ tự ảnh, cắt nối thẳng không thêm cảnh chuyển tiếp.",
});

export const salesVideoCreativeTemplates: CreativeTemplate[] = [
  poses(2), poses(4), poses(6),
  { ...poses(4), id: "poses-narrated", name: "Tạo dáng từ 4 ảnh + thuyết minh", files: [...photos(4), audio("Giọng nói mẫu")], text: "Lời thoại", workflow: "narration" },
  { id: "replace-background", name: "Thay nền video", files: [{ ...photo("Phông nền mới"), name: "background" }, { name: "video", label: "Video mẫu", kind: "video" }], defaultSeconds: 15, workflow: "background", instruction: "Thay riêng phần phông nền của @Video1 bằng không gian trong @Image1. Giữ nguyên nhân vật, tóc, quần áo, sản phẩm, vật thể, bóng đổ và mọi chuyển động ở tiền cảnh. Bám sát viền tóc, bàn tay và sản phẩm; không làm mờ, xóa hoặc vẽ lại chủ thể." },
  { id: "ad-remake", name: "Thay nhân vật trong video quảng cáo", files: [photo("Ảnh mẫu nhân vật mới"), { name: "video", label: "Video mẫu", kind: "video" }], durations: [10, 15], workflow: "remake", instruction: "Thay người giới thiệu trong @Video1 bằng đúng người trong @Image1. Giữ nguyên sản phẩm và bao bì; tái tạo bố cục, cỡ cảnh, chuyển động máy quay, cử chỉ chính, thứ tự cảnh và nhịp cắt của video gốc. Người mới phải giữ cùng danh tính, khuôn mặt, tóc và trang phục trong toàn bộ clip. Không thêm sản phẩm, chữ hoặc cảnh không có trong mẫu." },
];

export const salesVideoFileTypes = {
  image: salesVideoImageTypes.join(","),
  video: "video/mp4,video/quicktime,.mp4,.mov",
  audio: "audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac",
};
export const salesVideoFileLimits = {
  image: salesVideoImageLimit,
  audio: 15 * 1024 * 1024,
  video: 35 * 1024 * 1024,
};

export const salesVideoModels = {
  higgsfield: "Seedance 2.0 · Higgsfield",
  "pixverse-avatar": "PixVerse Image Avatar · Âm thanh tham chiếu",
} as const;

export function salesVideoModelOptions(template?: CreativeTemplate): (keyof typeof salesVideoModels)[] {
  if (!template) return ["higgsfield"];
  if (template.workflow === "remake" || template.workflow === "background") return [];
  if (template.workflow === "audio") return ["pixverse-avatar"];
  return ["higgsfield"];
}

export const salesVideoTextExamples: Record<string, string> = {
  "poses-narrated": "Mẫu áo này có dáng rộng và đường may ở vai. Đây là góc nhìn trước và sau khi mặc.",
};

export const salesVideoProductExamples: Record<string, string> = {
  general: "Bình nước inox 750 ml", fashion: "Áo sơ mi linen màu be", home: "Máy hút bụi cầm tay",
  snacks: "Khoai lang sấy giòn", consumer: "Nước rửa chén hương chanh", beauty: "Son dưỡng không màu",
  baby: "Bình tập uống hai tay cầm", tech: "Tai nghe không dây", accessories: "Túi đeo chéo màu nâu",
  footwear: "Giày sneaker trắng", decor: "Đèn bàn gốm", school: "Sổ tay gáy lò xo A5",
  supplements: "Viên bổ sung vitamin C", toys: "Bộ xếp hình gỗ", vehicles: "Xe đạp gấp", pets: "Dây dắt chó điều chỉnh được",
};

export const salesVideoHookStyles = [
  { id: "pain", label: "Vấn đề đời thường", hint: "Bắt đầu bằng sự bực bội, bất tiện hoặc thói quen sai lầm phổ biến." },
  { id: "skeptical", label: "Hoài nghi", hint: "Bắt đầu bằng sự hoài nghi ('Tưởng phí tiền ai ngờ...', 'Đồ rẻ thế này dùng được không?')." },
  { id: "curiosity", label: "Gợi tò mò", hint: "Gợi mở một chi tiết nhỏ bất ngờ tạo vòng lặp tò mò (Open Loop)." },
  { id: "visual_action", label: "Thao tác trực quan", hint: "Hành động bất ngờ, test thực tế hoặc cận cảnh chi tiết ngay giây đầu." },
] as const;

export const salesVideoTargetAudiences = [
  { id: "general", label: "Đại chúng", pronoun: "mọi người / cả nhà", hint: "Lịch sự, gần gũi, phù hợp đa số sản phẩm." },
  { id: "office_women", label: "Dân văn phòng", pronoun: "mấy bà / các bồ", hint: "Thân mật, chia sẻ mẹo vặt, làm đẹp, đồ tiện lợi." },
  { id: "moms", label: "Gia đình có con nhỏ", pronoun: "các mom / mấy mẹ", hint: "Đồng cảm nỗi vất vả, an toàn, chăm sóc bé." },
  { id: "men_tech", label: "Nam giới, công nghệ, xe", pronoun: "anh em / các bác", hint: "Thực tế, thẳng thắn, test tính năng, độ bền." },
  { id: "genz_students", label: "Học sinh, sinh viên", pronoun: "các bồ / team săn deal", hint: "Nhanh gọn, hài hước, tiết kiệm, bắt trend nhẹ nhàng." },
] as const;

export const salesVideoPainExamples: Record<string, string> = {
  general: "Dùng đồ rẻ thì nhanh hỏng, mua đồ xịn thì quá đắt.",
  fashion: "Mặc đồ lên form bị lùng thùng, giặt hai nước là nhăn nhúm mất dáng.",
  home: "Dọn dẹp chà muốn gãy tay vẫn bẩn dầu mỡ bám két.",
  snacks: "Đói đêm mà toàn đồ ngọt ngấy, mở gói ra thì ỉu xìu.",
  consumer: "Giấy ăn lau ướt bị mủn dính đầy mặt, nước giặt không thơm lâu.",
  beauty: "Bôi kem chống nắng bóng nhẫy như chảo dầu, chiều về bít tắc mụn.",
  baby: "Nửa đêm mắt nhắm mắt mở canh nhiệt độ pha sữa cho con.",
  tech: "Dây cáp sạc rối tung, củ sạc to nặng cồng kềnh lại nhanh nóng.",
  accessories: "Phối đồ đơn giản nhìn nhạt nhòa, thiếu điểm nhấn có gu.",
  footwear: "Đi bộ nửa tiếng là trầy gót, đau nhức lòng bàn chân.",
  decor: "Phòng trọ cũ kỹ nhìn u ám, không gian bừa bộn tụt hứng.",
  school: "Bàn học lộn xộn, ngồi vào là mất tập trung cầm điện thoại.",
  supplements: "Viên uống to khó nuốt, lịch uống cầu kỳ nên hay quên.",
  toys: "Trẻ con đi học về là dán mắt vào tivi điện thoại cả ngày.",
  vehicles: "Đi mưa gương mờ tịt không nhìn thấy xe sau nguy hiểm.",
  pets: "Mùa rụng lông bám đầy sofa quần áo quét mãi không hết.",
};

export const salesVideoHeroExamples: Record<string, string> = {
  general: "Thiết kế nhỏ gọn vừa lòng bàn tay, hoàn thiện kim loại chắc chắn.",
  fashion: "Chất vải đứng form tự nhiên, giặt máy thoải mái không cần ủi.",
  home: "Xịt bọt tan cặn dầu mỡ trong 10 giây, lau một đường là sạch bong.",
  snacks: "Cắn vào giòn rụm rộp rộp, vị cay tê bùng nổ không bị ngấy.",
  consumer: "Chất giấy 4 lớp dai mịn nhúng nước không rách, siêu tiết kiệm.",
  beauty: "Chất gel trong suốt ráo mịn trong 5 giây, kiềm dầu suốt 8 tiếng.",
  baby: "Van chống sặc thông minh và giữ nhiệt chuẩn xác cả đêm.",
  tech: "Sạc nhanh 65W nhỏ bằng hộp diêm, cắm 30 phút đầy 60% pin.",
  accessories: "Điểm nhấn kim loại mạ tinh xảo, phối với áo thun là nổi bật.",
  footwear: "Đế đệm khí êm nhẹ như chân trần, uốn cong 360 độ.",
  decor: "Ánh sáng vàng ấm hắt tường biến phòng ngủ thành homestay.",
  school: "Kệ xoay 360 độ gom gọn toàn bộ bút sách trong một góc nhỏ.",
  supplements: "Gói thạch nhỏ xé ăn liền vị đào thơm ngon, tiện bỏ túi áo.",
  toys: "Ghép khớp nam châm chắc chắn, thả rơi tự do không vỡ góc.",
  vehicles: "Xịt nano trượt nước mưa tức thì trong 10 giây.",
  pets: "Lược răng kép bấm một nút là đẩy toàn bộ búi lông ra ngoài.",
};

export const salesVideoFlawExamples: Record<string, string> = {
  general: "Hộp đóng gói hơi đơn giản, nhưng chất lượng bên trong rất đầm tay.",
  fashion: "Bảng màu hơi ít tông sáng, nhưng các màu cơ bản rất dễ phối.",
  home: "Mùi tràm trà khử khuẩn hơi nồng trong 30 giây đầu.",
  snacks: "Hơi cay so với người không ăn được ớt, nhưng ai ăn cay thì mê.",
  consumer: "Bịch to hơi chiếm diện tích kệ bếp một chút.",
  beauty: "Chất gel lúc mới bơm ra hơi mát lạnh nhẹ một chút.",
  baby: "Thân bình hơi to so với túi bỉm sữa loại nhỏ.",
  tech: "Bề mặt bóng nhẹ dễ bám chút vân tay nếu tay nhiều mồ hôi.",
  accessories: "Khóa cài lúc mới dùng hơi chặt tay một xíu.",
  footwear: "Màu trắng nên đi trời mưa cần chú ý tránh bùn bẩn.",
  decor: "Dây cắm dài 1.2m nên góc nào xa ổ điện cần ổ nối.",
  school: "Khay chứa bút hơi sâu với các loại bút chì gọt ngắn.",
  supplements: "Giá nhỉnh hơn loại viên uống truyền thống một chút.",
  toys: "Nhiều chi tiết nhỏ nên bé dưới 3 tuổi cần có bố mẹ chơi cùng.",
  vehicles: "Lọ xịt nhỏ bỏ cốp tiện nhưng chỉ đủ dùng khoảng 5–6 lần.",
  pets: "Răng lược bằng thép nên ban đầu cần chải nhẹ tay cho bé quen.",
};


export function salesVideoSupportsDialogue(model?: VideoGenerationModelOption) {
  // MiniMax can follow spoken dialogue in the prompt even when MaiVideo
  // does not advertise a separate audio toggle for this model.
  return model?.id === "minimax-h3" || model?.supportsAudio !== false;
}

export function salesVideoProductSegments(seconds: number, model?: VideoGenerationModelOption, requestedQuality?: string) {
  const quality = requestedQuality && model?.qualities.includes(requestedQuality)
    ? requestedQuality
    : model?.qualities.includes("720p") ? "720p" : model?.qualities[0] || "";
  const max = Math.min(15, model?.maxDurationByQuality?.[quality] || model?.maxDurationSec || 15);
  const clipMax = max;
  const count = Math.ceil(seconds / clipMax);
  return Array.from({ length: count }, (_, index) =>
    Math.ceil(seconds * (index + 1) / count) - Math.ceil(seconds * index / count));
}

export function salesVideoDurationOptions(
  model?: VideoGenerationModelOption,
  template?: CreativeTemplate,
  productTemplate = false,
  fallbackModelId = "",
  requestedQuality?: string,
) {
  const isWan = (model?.id || fallbackModelId) === "wan-3.0";
  const quality = requestedQuality && model?.qualities.includes(requestedQuality) ? requestedQuality : model?.qualities[0] || "";
  const configuredMax = model?.maxDurationByQuality?.[quality] || model?.maxDurationSec || (isWan ? 30 : 15);
  const max = isWan ? 30 : Math.min(15, configuredMax);
  if (productTemplate) {
    const clipMax = Math.min(15, configuredMax);
    const candidate = isWan ? [15, 20, 25, 30, 45, 60] : [...salesVideoDurations];
    // Long videos are stitched from separate prompts. Keep the number of
    // clips within the six-segment limit used by the draft and generation APIs.
    return candidate.filter((duration) => Math.ceil(duration / clipMax) <= 6);
  }
  const isComposedImageWorkflow = template?.workflow === "poses" || template?.workflow === "narration";
  const photoPairs = isComposedImageWorkflow
    ? Math.ceil(template.files.filter((file) => file.kind === "image").length / 2)
    : 0;
  const supportsFiveSecondSegment = !model || (!isWan
    && (model.minDurationSec || 1) <= 5
    && configuredMax >= 5
    && (!model.supportedDurationsSec?.length || model.supportedDurationsSec.includes(5)));
  if (isComposedImageWorkflow && !supportsFiveSecondSegment) return [];
  const min = Math.max(5, model?.minDurationSec || 5, photoPairs * 5);
  const candidate = template?.durations
    ?? (productTemplate || !template ? salesVideoDurations : salesVideoPromptDurations);
  const supported = !isWan && !isComposedImageWorkflow && model?.supportedDurationsSec?.length
    ? new Set(model.supportedDurationsSec)
    : undefined;
  return candidate.filter((duration) => duration >= Math.max(min, isWan ? 15 : 5) && duration <= max && (!supported || supported.has(duration)));
}

export function salesVideoMaiVideoModels(models: VideoGenerationModelOption[], template?: CreativeTemplate, ratio?: string) {
  const pixverseReferenceWorkflow = template?.workflow === "remake" || template?.workflow === "background";
  if (template && !pixverseReferenceWorkflow && !["prompt", "poses", "narration"].includes(template.workflow)) return [];
  const images = !template ? 2 : template.workflow === "prompt" ? template.files.length : 2;
  const composedImages = template?.workflow === "poses" || template?.workflow === "narration";
  const pixverseV6 = models.find((model) => model.provider === "maivideo" && model.id.trim().toLowerCase() === "v6");
  const pixverseV6Fallback: VideoGenerationModelOption = {
    id: "v6",
    label: "PixVerse V6 Reference",
    provider: "maivideo",
    qualities: ["480p", "720p", "1080p"],
    aspectRatios: ["9:16", "16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"],
    minDurationSec: 1,
    maxDurationSec: 15,
    supportsMultiShot: true,
    supportsAudio: true,
    supportsOffPeak: true,
    maxReferenceImages: 7,
    promptMaxLength: 5_000,
  };
  const candidates = pixverseReferenceWorkflow
    ? [{ ...pixverseV6Fallback, ...(pixverseV6 || {}), id: "v6", label: "PixVerse V6 Reference", provider: "maivideo" as const }]
    : models;
  return candidates.filter((model) => model.provider === "maivideo"
    && (!pixverseReferenceWorkflow || model.id.trim().toLowerCase() === "v6")
    && (!images || (model.maxReferenceImages ?? 0) >= images)
    && (!ratio || !model.aspectRatios?.length || model.aspectRatios.includes(ratio))
    && (!composedImages || (model.id !== "wan-3.0" && (model.minDurationSec || 1) <= 5
      && model.maxDurationSec >= 5 && (!model.supportedDurationsSec?.length || model.supportedDurationsSec.includes(5))))
    && (salesVideoSupportsDialogue(model) || (template && template.workflow !== "prompt"))
    && model.maxDurationSec >= 5);
}

export function salesVideoProductReferenceLock(productImageCount = 1) {
  const count = Math.max(1, Math.floor(productImageCount));
  const supplementary = count > 1
    ? ` @Image3–@Image${count + 1} are optional secondary references for matching details or a separate cutaway only; they must not replace, override, or be combined with the primary product in @Image2.`
    : " No secondary product references were supplied.";
  return `REFERENCE LOCK — @Image1 is the only presenter. @Image2 is the one primary product image and the single source of truth for the product held by the presenter.${supplementary} Preserve the same presenter's identity in every frame: face, skin tone, hair, body proportions, age appearance, and outfit. Keep the hero product unchanged with the exact silhouette, dimensions, materials, colors, components, logo, label layout, and visible text shown in @Image2. Secondary references may support a separate cutaway of a detail, included accessory, or context that is actually visible in that image; never invent an item, combine separate objects, or let a secondary view change the hero product. Do not morph, replace, duplicate, redesign, remove, or invent details on any reference. Keep hands and product contact anatomically plausible; maintain realistic scale, perspective, lighting, and continuity from shot to shot.`;
}

export function salesVideoProductInstructionForImages(productImageCount = 1) {
  const count = Math.max(1, Math.floor(productImageCount));
  const supplementary = count > 1
    ? ` Use @Image3–@Image${count + 1} only for a separate cutaway of details, included accessories or context actually visible in those images; do not substitute a secondary object for @Image2 or put it in the presenter's hand.`
    : " Keep every product shot grounded in @Image2.";
  return `${salesVideoProductReferenceLock(count)} VISUAL DIRECTION: Establish a believable medium shot at eye level with a natural 35–50mm equivalent perspective. Keep the presenter eyes near the upper third and the entire primary product from @Image2 unobstructed within the central safe area, with breathing room around its edges. The presenter may hold/show only the exact item from @Image2; use a relaxed stable grip, keep fingers away from the lens, screen, labels and controls, and do not rotate it beyond views supported by the image.${supplementary} Use a stable camera or one slow, short push-in per shot; never combine orbit, zoom and handheld motion. For details, cut to a steady close-up of a surface actually visible in @Image2; keep sufficient depth of field for the whole product, with no focus pumping. Do not reveal an unseen rear, underside, ports or internal parts, spin it 360 degrees, or invent controls and screen content. Demonstrate one simple action at a time with a stable grip. Preserve rigid geometry, component count, relative component positions and label orientation throughout movement. Use soft directional daylight, consistent shadows and reflections, true material texture and natural skin detail. Avoid glossy CGI surfaces, artificial beauty smoothing, exaggerated bokeh, ultrawide distortion, floating objects and sudden scale changes. Prefer a clean cut between supported views over a complex product rotation. Across generated clips keep camera height, lens perspective, room, lighting direction, wardrobe and product orientation consistent; plan an intentional cutaway at the join instead of claiming a seamless continuous take.`;
}

export const salesVideoProductInstruction = salesVideoProductInstructionForImages(1);

const salesVideoLanguageLocales: Record<string, string> = {
  "Tiếng Việt": "vi", English: "en", ไทย: "th", 한국어: "ko", 日本語: "ja", Deutsch: "de",
  Français: "fr", Italiano: "it", Русский: "ru", 粵語: "yue", Español: "es", فارسی: "fa",
  中文: "zh", Português: "pt", Tagalog: "tl", "Bahasa Indonesia": "id", हिन्दी: "hi", বাংলা: "bn",
  اردو: "ur", "Naijíriá Píjin": "pcm",
};

export function salesVideoMaxWordsPerSecond(language: string) {
  return language === "Tiếng Việt" ? null : 4;
}

export function salesVideoMaxWordCount(duration: number, language: string) {
  const wordsPerSecond = salesVideoMaxWordsPerSecond(language);
  return wordsPerSecond === null ? null : Math.floor(duration * wordsPerSecond);
}

// Estimate only for placing SRT cues; this is not a script-generation or validation limit.
function salesVideoEstimatedSpeechWordsPerSecond(language: string) {
  return language === "Tiếng Việt" ? 3 : 4;
}

export function salesVideoWordCount(text: string, language: string) {
  const value = text.trim().replace(/^\s*(?:Người hỏi(?:\s*\(ngoài khung hình\))?|Người trả lời|Người giới thiệu)\s*:\s*/gimu, "");
  if (!value) return 0;
  if (language === "Tiếng Việt") return value.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  try {
    const locale = salesVideoLanguageLocales[language] || "en";
    return [...new Intl.Segmenter(locale, { granularity: "word" }).segment(value)]
      .filter((segment) => segment.isWordLike).length;
  } catch {
    return value.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  }
}

export type SalesVideoTimedDialogueSegment = { start: number; duration: number; script: string };

export function salesVideoSplitDialogue(script: string, segments: Array<{ start: number; duration: number }>, totalSeconds: number, language: string): SalesVideoTimedDialogueSegment[] {
  const lines = script.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const grouped = segments.map(() => [] as string[]);
  if (lines.length) {
    const counts = lines.map((line) => Math.max(1, salesVideoWordCount(line, language)));
    const totalWords = counts.reduce((sum, count) => sum + count, 0);
    let wordsPassed = 0;
    lines.forEach((line, index) => {
      const midpoint = ((wordsPassed + counts[index] / 2) / totalWords) * totalSeconds;
      const segmentIndex = Math.max(0, segments.findIndex((segment) => midpoint <= segment.start + segment.duration));
      grouped[Math.min(segmentIndex, grouped.length - 1)]?.push(line);
      wordsPassed += counts[index];
    });
  }
  return segments.map((segment, index) => ({ ...segment, script: grouped[index].join("\n") }));
}

function formatSrtTimestamp(milliseconds: number) {
  const value = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const fraction = value % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(fraction).padStart(3, "0")}`;
}

export function salesVideoDialogueToSrt(segments: SalesVideoTimedDialogueSegment[], language: string) {
  const wordsPerSecond = salesVideoEstimatedSpeechWordsPerSecond(language);
  const cues: string[] = [];
  for (const segment of segments) {
    const lines = segment.script.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const counts = lines.map((line) => Math.max(1, salesVideoWordCount(line, language)));
    const totalWords = counts.reduce((sum, count) => sum + count, 0);
    const clipMs = segment.duration * 1_000;
    const paddingMs = Math.min(350, Math.floor(clipMs / 10));
    const gapMs = lines.length > 1 ? Math.min(350, Math.floor((clipMs - 2 * paddingMs) / (lines.length - 1) / 3)) : 0;
    const availableMs = Math.max(100, clipMs - 2 * paddingMs - gapMs * (lines.length - 1));
    const speechMs = Math.min(availableMs, totalWords / wordsPerSecond * 1_000);
    let cursor = segment.start * 1_000 + paddingMs;
    let speechAllocated = 0;
    lines.forEach((line, index) => {
      const cueDuration = index === lines.length - 1
        ? Math.max(100, Math.round(speechMs - speechAllocated))
        : Math.max(100, Math.round(speechMs * counts[index] / totalWords));
      const match = line.match(/^(Người hỏi(?:\s*\(ngoài khung hình\))?|Người trả lời|Người giới thiệu)\s*:\s*(.*)$/iu);
      const speaker = match?.[1]?.startsWith("Người hỏi") ? "Người hỏi" : match?.[1] ? "Người trả lời" : "";
      const spokenText = match ? match[2] : line;
      const caption = speaker ? `${speaker}: ${spokenText}` : spokenText;
      cues.push(`${cues.length + 1}\n${formatSrtTimestamp(cursor)} --> ${formatSrtTimestamp(cursor + cueDuration)}\n${caption}`);
      speechAllocated += cueDuration;
      cursor += cueDuration + gapMs;
    });
  }
  return cues.join("\n\n");
}

export function salesVideoProductScriptInstruction(script: string, language: string, audio: boolean) {
  const line = script.trim();
  if (!line) return "";
  const hasSpeakerLabels = /^(?:Người hỏi(?:\s*\(ngoài khung hình\))?|Người trả lời|Người giới thiệu)\s*:/imu.test(line);
  return audio
    ? hasSpeakerLabels
      ? `Lời thoại bằng ${language} do người dùng cung cấp. Đọc nguyên văn nội dung sau dấu hai chấm; các nhãn vai chỉ là cue phân vai, không đọc thành tiếng. Người hỏi ở ngoài khung hình, người trả lời là nhân vật tham chiếu; không tự thêm hoặc lược lời: ${JSON.stringify(line)}. Phát âm tự nhiên, vừa thời lượng.`
      : `Lời thoại bằng ${language} do người dùng cung cấp; đọc nguyên văn, phát âm tự nhiên, vừa thời lượng, không tự thêm hoặc lược lời: ${JSON.stringify(line)}.`
    : `Kịch bản tham khảo bằng ${language}: ${JSON.stringify(line)}. Chỉ dùng để chọn hành động và hình ảnh phù hợp; không tạo giọng nói hoặc yêu cầu nhép miệng.`;
}

export function salesVideoProductPrompt(input: {
  product: string;
  direction: string;
  language: string;
  facts: string;
  seconds: number;
  ratio: string;
  audio: boolean;
}) {
  return [
    `Tạo quảng cáo UGC dài ${input.seconds} giây, khung hình ${input.ratio}, cho sản phẩm có tên ${JSON.stringify(input.product)}.`,
    input.direction,
    "Dựng một quảng cáo chân thực như video quay bằng máy ảnh thật: ánh sáng tự nhiên, chuyển động máy nhẹ và ổn định, cử chỉ đời thường, thao tác đúng vật lý. Mở đầu bằng cảnh dễ nhận ra sản phẩm, tiếp theo minh họa một thao tác cụ thể, rồi kết bằng cảnh sản phẩm rõ nét. Tránh hiệu ứng phô trương, chuyển cảnh đột ngột, vật thể bay hoặc cảnh quay bất khả thi.",
    input.facts && `Thông tin sản phẩm do người dùng cung cấp: ${JSON.stringify(input.facts)}. Dùng các thông tin này để chọn cảnh minh họa phù hợp.`,
    input.audio
      ? `Nếu người dùng không cung cấp lời thoại riêng, viết và nói lời thoại ngắn, tự nhiên bằng ${input.language}. Nói đúng tên sản phẩm. Canh lời thoại vừa thời lượng đã chọn.`
      : "Dùng hành động và góc quay để truyền tải thông tin. Không yêu cầu giọng nói hoặc nhép miệng.",
    "Chỉ trình bày chi tiết thấy trong ảnh hoặc do người dùng cung cấp. Không tự thêm công dụng, giá, khuyến mãi, bao bì, logo hoặc chữ trên nhãn.",
  ].filter(Boolean).join("\n");
}
