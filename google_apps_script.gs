// ════════════════════════════════════════════════════════════════
//  픽유어굿즈 쿠션 및 패브릭 - GAS 백엔드
//  이 코드를 Google Apps Script (script.google.com) 에 붙여넣으세요
//
//  ⚠️ 코드 수정 후 반드시 재배포 필요:
//  배포 → 배포 관리 → ✏️ 수정 → 버전: [새 버전] → 배포
// ════════════════════════════════════════════════════════════════

// ⚙️  주문 파일이 저장될 Google Drive 폴더 이름
const FOLDER_NAME = '픽유어굿즈_쿠션패브릭_주문';

// ⚙️  스팸 방지 토큰 — 프론트엔드와 동일해야 함
const ACCESS_TOKEN = 'pyg-cushion-2026-k8m3n';

// ⚙️  주문 알림 받을 이메일
const OWNER_EMAIL = 'dktex0514@gmail.com';


// ────────────────────────────────────────────────────────────────
//  GET 요청 처리
// ────────────────────────────────────────────────────────────────
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ────────────────────────────────────────────────────────────────
//  POST 요청 처리
// ────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ── 스팸 방지: 토큰 검증 ──
    if (data._token !== ACCESS_TOKEN) {
      return jsonResponse({ success: false, error: '인증 실패: 유효하지 않은 요청입니다.' });
    }

    // ── Gemini 이미지 변환 ──
    if (data.action === 'gemini_transform') {
      return handleGeminiTransform(data);
    }

    // ── 누끼따기 (Pixian.AI) ──
    if (data.action === 'remove_bg') {
      return handlePixianBg(data);
    }

    // ── 주문 저장 ──
    if (data.action === 'order') {
      return handleOrder(data);
    }

    return jsonResponse({ success: false, error: '알 수 없는 요청입니다.' });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ────────────────────────────────────────────────────────────────
//  📦 주문 처리
// ────────────────────────────────────────────────────────────────
function handleOrder(data) {
  const name      = data.name     || '(이름 없음)';
  const phone     = data.phone    || '(연락처 없음)';
  const email     = data.email    || '(이메일 없음)';
  const product   = data.product  || '(상품 미지정)';
  const material  = data.material || '';
  const size      = data.size     || '(사이즈 미지정)';
  const price     = data.price    || 0;
  const imageData = data.imageData;

  if (!imageData) {
    return jsonResponse({ success: false, error: '이미지 데이터가 없습니다.' });
  }

  // 1) Google Drive에 이미지 저장
  const dateFolder = getOrCreateDateFolder(FOLDER_NAME);
  const dateStr    = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const seq        = getTodayOrderSeq(dateFolder);
  const safeName   = name.replace(/[^\uAC00-\uD7A3a-zA-Z0-9]/g, '');
  const safePhone  = phone.replace(/[^0-9]/g, '');
  const filename   = dateStr + '_' + seq + '_' + safeName + '_' + safePhone + '.jpg';
  const blob       = Utilities.newBlob(
    Utilities.base64Decode(imageData),
    'image/jpeg',
    filename
  );
  const file = dateFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=drivesdk';
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

  // 2) 사장님에게 알림 이메일
  let ownerMailOk = false, customerMailOk = false;
  let mailError = '';
  try {
    sendOwnerEmail(name, phone, email, product, material, size, price, fileUrl, timestamp);
    ownerMailOk = true;
  } catch(mailErr) {
    mailError += '사장님 메일 오류: ' + mailErr.message + ' / ';
  }

  // 3) 고객에게 접수 확인 이메일
  if (email && email.indexOf('@') > 0 && email !== '(이메일 없음)') {
    try {
      sendCustomerEmail(name, phone, email, product, material, size, price, fileUrl, file, timestamp);
      customerMailOk = true;
    } catch(mailErr) {
      mailError += '고객 메일 오류: ' + mailErr.message;
    }
  }

  // 4) 썸네일 URL
  const thumbnailUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w300';

  return jsonResponse({
    success: true,
    mailSent: { owner: ownerMailOk, customer: customerMailOk },
    mailError: mailError || undefined,
    thumbnailUrl: thumbnailUrl,
  });
}


// ────────────────────────────────────────────────────────────────
//  📧 사장님 알림 이메일
// ────────────────────────────────────────────────────────────────
function sendOwnerEmail(name, phone, email, product, material, size, price, fileUrl, timestamp) {
  const subject = '[픽유어굿즈 쿠션/패브릭] 새 주문 — ' + name + ' / ' + phone;

  const materialRow = material
    ? '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:700;">소재</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + material + '</td></tr>'
    : '';

  const htmlBody = '<div style="font-family:\'Noto Sans KR\',sans-serif; max-width:520px;">'
    + '<h2 style="color:#111;border-bottom:2px solid #111;padding-bottom:8px;">📦 새 주문이 접수되었습니다</h2>'
    + '<table style="border-collapse:collapse;width:100%;margin-top:16px;">'
    + '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:700;width:120px;">주문자 이름</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + name + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:700;">연락처</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + phone + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:700;">이메일</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + email + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#fff5f0;font-weight:700;">상품</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;color:#d2691e;">' + product + '</td></tr>'
    + materialRow
    + '<tr><td style="padding:8px 12px;background:#fff5f0;font-weight:700;">사이즈</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;color:#d2691e;">' + size + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#fff5f0;font-weight:700;">금액</td>'
    + '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;color:#d2691e;">' + Number(price).toLocaleString('ko-KR') + '원</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:700;">디자인 파일</td>'
    + '<td style="padding:8px 12px;"><a href="' + fileUrl + '" style="color:#0a6cf5;font-weight:700;">여기를 클릭하여 확인</a></td></tr>'
    + '</table>'
    + '<p style="margin-top:20px;font-size:13px;color:#888;">접수 시각: ' + timestamp + '</p>'
    + '</div>';

  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: subject,
    htmlBody: htmlBody,
  });
}


// ────────────────────────────────────────────────────────────────
//  📧 고객 접수 확인 이메일 + JPG 첨부
// ────────────────────────────────────────────────────────────────
function sendCustomerEmail(name, phone, email, product, material, size, price, fileUrl, file, timestamp) {
  const subject = '[픽유어굿즈] 주문 접수 확인 — ' + name + '님';

  const materialInfo = material ? '<p>소재: <strong>' + material + '</strong></p>' : '';

  const htmlBody = '<div style="font-family:\'Noto Sans KR\',sans-serif; max-width:560px; color:#222;">'
    + '<h2 style="color:#111;border-bottom:2px solid #111;padding-bottom:8px;">주문이 접수되었습니다!</h2>'
    + '<p style="margin-top:16px;">안녕하세요, <strong>' + name + '</strong>님!</p>'
    + '<p style="margin-top:12px;line-height:1.8;">정성을 담은 픽유어굿즈, 주문 접수가 완료되었습니다.<br><br>'
    + '혹시 디자인 수정이 필요하신가요? 저희 픽유어굿즈는 고객님의 만족을 위해 '
    + '제작 시작 전까지 자유롭게 수정을 지원합니다.</p>'
    + '<ul style="margin-top:14px;line-height:2;padding-left:20px;">'
    + '<li><strong>수정 안내:</strong> 별도로 연락하실 필요 없이, 오전 9시 전까지 새로 디자인을 접수해 주세요.</li>'
    + '<li><strong>제작 기준:</strong> 주문 다음 날 오전 9시에 가장 마지막으로 보내주신 디자인을 기준으로 제작에 들어갑니다.</li>'
    + '</ul>'
    + '<p style="margin-top:20px;font-weight:700;">예쁘게 제작해서 보내드리겠습니다. 감사합니다!</p>'
    + '<div style="margin-top:20px;padding:16px;background:#f9f9f9;border-radius:8px;">'
    + '<p style="font-weight:700;margin-bottom:8px;">접수 정보</p>'
    + '<p>이름: ' + name + '</p>'
    + '<p>연락처: ' + phone + '</p>'
    + '<p>상품: <strong>' + product + '</strong></p>'
    + materialInfo
    + '<p>사이즈: <strong>' + size + '</strong></p>'
    + '<p>금액: <strong>' + Number(price).toLocaleString('ko-KR') + '원</strong></p>'
    + '</div>'
    + '<p style="margin-top:24px;font-size:12px;color:#aaa;">문의사항이 있으시면 ' + OWNER_EMAIL + ' 로 연락주세요.</p>'
    + '</div>';

  const attachment = file.getBlob();
  attachment.setName(name + '_작업물.jpg');

  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: htmlBody,
    attachments: [attachment],
  });
}


// ────────────────────────────────────────────────────────────────
//  유틸 함수
// ────────────────────────────────────────────────────────────────
function getOrCreateFolder(name) {
  const iter = DriveApp.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : DriveApp.createFolder(name);
}

function getOrCreateDateFolder(parentName) {
  const parent  = getOrCreateFolder(parentName);
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const iter    = parent.getFoldersByName(dateStr);
  return iter.hasNext() ? iter.next() : parent.createFolder(dateStr);
}

function getTodayOrderSeq(dateFolder) {
  const files = dateFolder.getFiles();
  let count = 0;
  while (files.hasNext()) { files.next(); count++; }
  return String(count + 1).padStart(3, '0');
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ────────────────────────────────────────────────────────────────
//  Gemini AI 이미지 변환
//
//  설정: GAS → 프로젝트 설정 → 스크립트 속성
//  GEMINI_API_KEY: https://aistudio.google.com 에서 발급
// ────────────────────────────────────────────────────────────────
function handleGeminiTransform(data) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return jsonResponse({
        success: false,
        error: 'GEMINI_API_KEY가 설정되지 않았습니다.\n\nGAS 에디터 → 프로젝트 설정 → 스크립트 속성에서\n"GEMINI_API_KEY"를 추가해주세요.'
      });
    }

    if (!data.imageData) {
      return jsonResponse({ success: false, error: '이미지 데이터가 없습니다.' });
    }

    const prompt = data.prompt || 'Convert this photo into an artistic illustration style. Keep the subject recognizable.';
    const mimeType = data.mimeType || 'image/jpeg';

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + apiKey;

    const payload = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: data.imageData } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT']
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      return jsonResponse({
        success: false,
        error: 'Gemini API 오류 (HTTP ' + code + '): ' + response.getContentText().substring(0, 500)
      });
    }

    const result = JSON.parse(response.getContentText());
    const parts = result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts;

    if (!parts) {
      return jsonResponse({ success: false, error: '이미지 생성에 실패했습니다.' });
    }

    let imageData = null;
    let imageMime = 'image/png';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].inlineData && parts[i].inlineData.data) {
        imageData = parts[i].inlineData.data;
        imageMime = parts[i].inlineData.mimeType || 'image/png';
        break;
      }
    }

    if (!imageData) {
      return jsonResponse({ success: false, error: 'Gemini가 이미지를 반환하지 않았습니다.' });
    }

    return jsonResponse({ success: true, imageData: imageData, mimeType: imageMime });

  } catch (err) {
    return jsonResponse({ success: false, error: 'Gemini 변환 오류: ' + err.message });
  }
}


// ────────────────────────────────────────────────────────────────
//  누끼따기 (Pixian.AI)
//
//  설정: GAS → 프로젝트 설정 → 스크립트 속성
//  PIXIAN_API_ID, PIXIAN_API_SECRET: https://pixian.ai/api
// ────────────────────────────────────────────────────────────────
function handlePixianBg(data) {
  try {
    const apiId     = PropertiesService.getScriptProperties().getProperty('PIXIAN_API_ID');
    const apiSecret = PropertiesService.getScriptProperties().getProperty('PIXIAN_API_SECRET');
    if (!apiId || !apiSecret) {
      return jsonResponse({
        success: false,
        error: 'PIXIAN_API_ID 또는 PIXIAN_API_SECRET이 설정되지 않았습니다.'
      });
    }

    if (!data.imageData) {
      return jsonResponse({ success: false, error: '이미지 데이터가 없습니다.' });
    }

    const imageBytes = Utilities.base64Decode(data.imageData);
    const imageBlob  = Utilities.newBlob(imageBytes, 'image/jpeg', 'image.jpg');
    const credentials = Utilities.base64Encode(apiId + ':' + apiSecret);

    const response = UrlFetchApp.fetch('https://api.pixian.ai/api/v2/remove-background', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + credentials },
      payload: { 'image': imageBlob },
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      return jsonResponse({
        success: false,
        error: 'Pixian.AI 오류 (HTTP ' + code + '): ' + response.getContentText().substring(0, 400)
      });
    }

    const resultBase64 = Utilities.base64Encode(response.getContent());
    return jsonResponse({ success: true, imageData: resultBase64, mimeType: 'image/png' });

  } catch (err) {
    return jsonResponse({ success: false, error: '누끼따기 오류: ' + err.message });
  }
}


// ────────────────────────────────────────────────────────────────
//  테스트 함수들 (GAS 에디터에서 직접 실행)
// ────────────────────────────────────────────────────────────────
function testPixianSetup() {
  const apiId     = PropertiesService.getScriptProperties().getProperty('PIXIAN_API_ID');
  const apiSecret = PropertiesService.getScriptProperties().getProperty('PIXIAN_API_SECRET');
  if (!apiId || !apiSecret) {
    Logger.log('PIXIAN_API_ID 또는 PIXIAN_API_SECRET이 스크립트 속성에 없습니다!');
    return;
  }
  Logger.log('API 키 발견: ' + apiId);

  const minPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const imageBlob = Utilities.newBlob(Utilities.base64Decode(minPng), 'image/png', 'test.png');
  const credentials = Utilities.base64Encode(apiId + ':' + apiSecret);

  const res = UrlFetchApp.fetch('https://api.pixian.ai/api/v2/remove-background', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + credentials },
    payload: { 'image': imageBlob, 'test': 'true' },
    muteHttpExceptions: true,
  });

  Logger.log('Pixian.AI 응답 코드: ' + res.getResponseCode());
  if (res.getResponseCode() === 200) {
    Logger.log('Pixian.AI 연결 성공!');
  } else {
    Logger.log('오류: ' + res.getContentText().substring(0, 300));
  }
}

function testGeminiSetup() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('GEMINI_API_KEY가 스크립트 속성에 없습니다!');
    return;
  }
  Logger.log('API 키 발견: ' + apiKey.substring(0, 12) + '...');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ contents: [{ parts: [{ text: 'Say "OK"' }] }] }),
    muteHttpExceptions: true
  });

  Logger.log('Gemini 응답 코드: ' + res.getResponseCode());
  if (res.getResponseCode() === 200) {
    Logger.log('Gemini API 연결 성공!');
  } else {
    Logger.log('오류: ' + res.getContentText().substring(0, 300));
  }
}

function testEmailSetup() {
  const remaining = MailApp.getRemainingDailyQuota();
  Logger.log('남은 일일 이메일 한도: ' + remaining + '통');
  if (remaining < 2) {
    Logger.log('이메일 한도가 부족합니다!');
    return;
  }
  try {
    MailApp.sendEmail({
      to: OWNER_EMAIL,
      subject: '[픽유어굿즈 쿠션/패브릭] 이메일 테스트',
      htmlBody: '<h2>이메일 발송 테스트 성공!</h2><p>이 메일이 보이면 정상 작동합니다.</p>',
    });
    Logger.log('테스트 이메일 발송 성공! ' + OWNER_EMAIL + ' 에서 확인하세요.');
  } catch(err) {
    Logger.log('이메일 발송 실패: ' + err.message);
  }
}
