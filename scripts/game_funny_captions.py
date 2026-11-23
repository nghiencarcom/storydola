#!/usr/bin/env python3
"""Write burn-in Vietnamese captions for the two original game shorts."""
import argparse
from pathlib import Path


CAPTIONS = {
    "minecraft": [
        (0.0, 3.0, "SPEEDRUN: 1 DIAMOND", "Title"),
        (2.8, 7.0, "Hôm nay mình sẽ flex cực ngầu.", "Default"),
        (7.0, 11.0, "Bước 1: xây cầu an toàn.", "Default"),
        (11.0, 14.0, "Ủa... sao bệ bé vậy?", "Default"),
        (14.0, 18.0, "DIAMOND MINI?!", "Emphasis"),
        (18.0, 21.0, "Tới lúc dùng cuốc xịn.", "Default"),
        (21.0, 25.0, "MŨI CUỐC: 1   |   ĐẦU: 0", "Emphasis"),
        (25.0, 29.0, "Tôi có kế hoạch B.", "Default"),
        (29.0, 33.0, "Tính cả vụ TNT rồi!", "Default"),
        (33.0, 37.0, "Heo: tới giờ ăn trưa.", "Default"),
        (37.0, 42.0, "Ê! Viên kim cương của tôi!", "Emphasis"),
        (42.0, 48.0, "Nó parkour giỏi hơn mình!", "Default"),
        (48.0, 52.0, "Tóm được rồi!", "Default"),
        (52.0, 56.0, "HẮT XÌ!", "Emphasis"),
        (56.0, 60.0, "DIAMOND +1   |   UY TÍN -100", "Title"),
    ],
    "roblox": [
        (0.0, 3.0, "NOOB TỰ NHẬN PRO", "Title"),
        (3.0, 7.0, "Chỉ cần một cú nhảy.", "Default"),
        (7.0, 11.0, "Đường dễ nhất. Chắc chắn!", "Default"),
        (11.0, 15.0, "Ủa, nó đẩy ngược mình?", "Emphasis"),
        (15.0, 20.0, "QUẠT: 1   |   NOOB: 7 VÒNG", "Default"),
        (20.0, 24.0, "Pro: bình tĩnh...", "Default"),
        (24.0, 28.0, "...đang kẹt ở checkpoint.", "Default"),
        (28.0, 32.0, "Noob bật chế độ tập trung.", "Default"),
        (32.0, 37.0, "CÁI BỆ NÀY BAY THẬT À?", "Emphasis"),
        (37.0, 42.0, "Đây chắc chắn là đường tắt.", "Default"),
        (42.0, 47.0, "Hạ cánh chuẩn xác!", "Default"),
        (47.0, 53.0, "VÔ ĐỊCH OBBY!", "Title"),
        (53.0, 56.0, "Skill? Nhờ gió.", "Default"),
        (56.0, 60.0, "PRO? ĐỂ MAI TÍNH.", "Emphasis"),
    ],
}


def stamp(seconds):
    cs = round(seconds * 100)
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--kind", choices=tuple(CAPTIONS), required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "PlayResX: 720",
        "PlayResY: 1280",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: Default,Arial,44,&H00FFFFFF,&H0000FFFF,&H0010172B,&HA0000000,-1,0,0,0,100,100,0,0,1,4,2,2,48,48,142,1",
        "Style: Emphasis,Arial,48,&H0000E8FF,&H0000FFFF,&H0010172B,&HA0000000,-1,0,0,0,100,100,0,0,1,5,2,2,38,38,142,1",
        "Style: Title,Arial,44,&H0000E8FF,&H0000FFFF,&H0010172B,&HA0000000,-1,0,0,0,100,100,0,0,1,5,3,8,42,42,180,1",
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    for start, end, text, style in CAPTIONS[a.kind]:
        escaped = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        lines.append(f"Dialogue: 0,{stamp(start)},{stamp(end)},{style},,0,0,0,,{{\\fad(100,120)}}{escaped}")
    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
