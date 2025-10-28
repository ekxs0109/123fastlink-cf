/**
 * 189网盘秒传服务
 */

/**
 * 创建189网盘秒传JSON
 * @param {string} shareUrl - 分享链接
 * @param {string} sharePwd - 分享密码
 * @returns {Promise<object>} 秒传JSON对象
 */
export async function create189RapidTransfer(shareUrl, sharePwd) {
  // 支持两种格式: /t/xxx 或 ?code=xxx
  let match = shareUrl.match(/\/t\/([a-zA-Z0-9]+)/);
  if (!match) {
    match = shareUrl.match(/[?&]code=([a-zA-Z0-9]+)/);
  }
  if (!match) throw new Error("无效的189网盘分享链接 (支持格式: https://cloud.189.cn/t/xxx 或 https://cloud.189.cn/web/share?code=xxx)");

  const shareCode = match[1];
  let shareId = shareCode; // 默认使用shareCode
  
  // 如果有密码，需要先调用checkAccessCode获取真正的shareId
  if (sharePwd) {
    console.log(`[189] 验证访问码...`);
    const checkUrl = `https://cloud.189.cn/api/open/share/checkAccessCode.action?shareCode=${shareCode}&accessCode=${sharePwd}`;
    const checkRes = await fetch(checkUrl, {
      headers: {
        "Accept": "application/json;charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://cloud.189.cn/web/main/"
      }
    });
    
    const checkText = await checkRes.text();
    console.log(`[189] checkAccessCode响应:`, checkText.substring(0, 200));
    
    try {
      const checkData = JSON.parse(checkText);
      if (checkData.shareId) {
        shareId = checkData.shareId;
        console.log(`[189] 从checkAccessCode获取到shareId: ${shareId}`);
      }
    } catch (e) {
      console.log(`[189] checkAccessCode解析失败，继续使用shareCode`);
    }
  }
  
  // 构建请求参数
  const params = {
    shareCode: shareCode,
    accessCode: sharePwd || ""
  };
  
  // 添加认证签名
  const timestamp = Date.now().toString();
  const appKey = "600100422";
  
  const signData = {
    ...params,
    Timestamp: timestamp,
    AppKey: appKey
  };
  
  const signature = get189Signature(signData);
  
  const queryString = new URLSearchParams(params).toString();
  const apiUrl = `https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?${queryString}`;
  
  console.log(`[189] 请求分享信息: ${apiUrl}`);
  console.log(`[189] 签名参数:`, { timestamp, appKey, signature });
  
  const res = await fetch(apiUrl, {
    headers: {
      "Accept": "application/json;charset=UTF-8",
      "Sign-Type": "1",
      "Signature": signature,
      "Timestamp": timestamp,
      "AppKey": appKey,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36",
      "Referer": "https://cloud.189.cn/web/main/"
    }
  });
  
  const text = await res.text();
  
  console.log(`[189] 响应状态: ${res.status}`);
  console.log(`[189] 响应内容 (前500字符):`, text.substring(0, 500));
  
  // 尝试解析为JSON或XML
  let data;
  if (text.trim().startsWith('<')) {
    // XML响应
    console.log(`[189] 检测到XML响应，开始解析...`);
    data = parseXMLResponse(text);
    console.log(`[189] XML解析结果:`, JSON.stringify(data, null, 2));
  } else {
    // JSON响应 - 修复大整数精度问题
    console.log(`[189] 检测到JSON响应`);
    try {
      // 使用正则表达式将大整数ID转换为字符串
      const fixedText = text.replace(/"id":"?(\d{15,})"?/g, '"id":"$1"')
                            .replace(/"fileId":"?(\d{15,})"?/g, '"fileId":"$1"')
                            .replace(/"parentId":"?(\d{15,})"?/g, '"parentId":"$1"')
                            .replace(/"shareId":"?(\d{15,})"?/g, '"shareId":"$1"');
      data = JSON.parse(fixedText);
    } catch (e) {
      console.error(`[189] JSON解析失败:`, e.message);
      data = JSON.parse(text); // 回退到普通解析
    }
  }

  if (data.res_code !== 0) {
      if (data.res_code === 40401 && !sharePwd) {
          throw new Error("该分享需要提取码，请输入提取码");
      }
      throw new Error(`获取189分享信息失败: ${data.res_message || "未知错误"}`);
  }
  
  // 如果getShareInfoByCodeV2返回了shareId，更新它
  if (data.shareId && data.shareId !== shareCode) {
    shareId = data.shareId;
    console.log(`[189] 从getShareInfoByCodeV2更新shareId: ${shareId}`);
  }
  
  const fileId = data.fileId;
  const needAccessCode = data.needAccessCode;
  const isFolder = data.isFolder;
  const shareMode = data.shareMode || "0";

  console.log("[189] 分享信息:", { shareId, fileId, needAccessCode, isFolder, shareMode, shareCode, sharePwd });

  if (!shareId || !fileId) {
    if (needAccessCode === "1" && !sharePwd) {
      throw new Error("该分享需要提取码，请输入提取码");
    }
    throw new Error("获取189分享信息失败，可能是分享链接无效或已过期");
  }

  const files = await get189ShareFiles(shareId, fileId, fileId, "", shareMode, sharePwd, shareCode);

  return {
    commonPath: "",
    files,
    totalFilesCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
  };
}

/**
 * 递归获取189网盘分享文件列表
 */
async function get189ShareFiles(shareId, shareDirFileId, fileId, path = "", shareMode = "0", accessCode = "", shareCode = "") {
  const files = [];
  let page = 1;

  while (true) {
    const params = {
      pageNum: page.toString(),
      pageSize: "100",
      fileId: fileId.toString(),
      shareDirFileId: shareDirFileId.toString(),
      isFolder: "true",
      shareId: shareId.toString(),
      shareMode: shareMode,
      iconOption: "5",
      orderBy: "lastOpTime",
      descending: "true",
      accessCode: accessCode || ""
    };
    
    const queryString = new URLSearchParams(params).toString();
    const url = `https://cloud.189.cn/api/open/share/listShareDir.action?${queryString}`;
    console.log(`[189] 请求文件列表: page=${page}, fileId=${fileId}, shareDirFileId=${shareDirFileId}, path="${path}"`);
    
    // 构建Cookie，包含分享码和访问码的映射
    const cookies = [];
    if (shareCode && accessCode) {
      cookies.push(`share_${shareCode}=${accessCode}`);
    }
    
    const headers = {
      'Accept': 'application/json;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': 'https://cloud.189.cn/web/main/'
    };
    
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ');
    }
    
    const res = await fetch(url, { headers });
    const text = await res.text();
    
    console.log(`[189] 响应状态: ${res.status}, 内容前200字符:`, text.substring(0, 200));
    
    if (res.status !== 200) {
      console.error(`[189] API错误: ${res.status} ${res.statusText}`);
      break;
    }

    let data;
    try {
      // 使用正则表达式将大整数ID转换为字符串，避免精度丢失
      // 匹配类似 "id":424803211905070152 的模式，并加上引号
      const fixedText = text.replace(/"id":(\d{15,})/g, '"id":"$1"')
                            .replace(/"fileId":"?(\d{15,})"?/g, '"fileId":"$1"')
                            .replace(/"parentId":(\d{15,})/g, '"parentId":"$1"')
                            .replace(/"shareId":(\d{15,})/g, '"shareId":"$1"');
      data = JSON.parse(fixedText);
    } catch (e) {
      console.error(`[189] JSON解析失败:`, text.substring(0, 200));
      break;
    }

    if (data.res_code !== 0) {
      console.error(`[189] API返回错误: res_code=${data.res_code}, message=${data.res_message || '未知'}`);
      
      // 如果是FileNotFound错误，并且是在子文件夹中，给出提示
      if (data.res_code === "FileNotFound" && path) {
        console.log(`[189] 警告：子文件夹 "${path}" 访问失败，189网盘分享可能需要登录才能访问子文件夹`);
      }
      break;
    }

    const fileList = data.fileListAO?.fileList || [];
    const folderList = data.fileListAO?.folderList || [];
    const count = data.fileListAO?.count || 0;

    console.log(`[189] 找到: ${fileList.length}个文件, ${folderList.length}个文件夹, count=${count}`);

    for (const file of fileList) {
      const filePath = path ? `${path}/${file.name}` : file.name;
      files.push({ 
        path: filePath, 
        etag: (file.md5 || "").toLowerCase(),  // MD5转小写
        size: file.size 
      });
      console.log(`[189] 添加文件: ${filePath} (${file.size} bytes, MD5: ${file.md5})`);
    }

    for (const folder of folderList) {
      const folderPath = path ? `${path}/${folder.name}` : folder.name;
      console.log(`[189] 准备进入子文件夹: "${folderPath}", id=${folder.id}, parentId=${folder.parentId}`);
      
      // 进入子目录时，fileId 和 shareDirFileId 都使用子文件夹的 id
      const subFiles = await get189ShareFiles(
        shareId,
        folder.id,  // shareDirFileId 使用子文件夹的 id
        folder.id,  // fileId 也使用子文件夹的 id
        folderPath,
        shareMode,
        accessCode,
        shareCode
      );
      console.log(`[189] 子文件夹 "${folderPath}" 返回了 ${subFiles.length} 个文件`);
      files.push(...subFiles);
    }

    // 判断是否需要继续分页：
    // 1. 如果 fileList 和 folderList 都为空，说明没有更多数据
    // 2. 如果返回的总数量小于 pageSize，说明这是最后一页
    const totalItems = fileList.length + folderList.length;
    if (totalItems === 0 || totalItems < 100) {
      break;
    }
    
    page++;
  }

  console.log(`[189] 完成文件夹 "${path}": 共${files.length}个文件`);
  return files;
}

/**
 * 解析XML响应
 */
function parseXMLResponse(xmlText) {
  console.log("[189] 开始解析XML...");
  
  const getTagValue = (xml, tagName) => {
    const regex = new RegExp(`<${tagName}>([^<]*)<\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1] : null;
  };
  
  const res_code = parseInt(getTagValue(xmlText, 'res_code') || '0');
  const res_message = getTagValue(xmlText, 'res_message') || '';
  const shareId = getTagValue(xmlText, 'shareId') || '';
  const fileId = getTagValue(xmlText, 'fileId') || '';
  const shareMode = getTagValue(xmlText, 'shareMode') || '0';
  const isFolder = getTagValue(xmlText, 'isFolder') === 'true';
  const needAccessCode = getTagValue(xmlText, 'needAccessCode') || '0';
  const fileName = getTagValue(xmlText, 'fileName') || '';
  
  const parsed = {
    res_code,
    res_message,
    shareId,
    fileId,
    shareMode,
    isFolder,
    needAccessCode,
    fileName
  };
  
  console.log("[189] XML解析完成:", parsed);
  return parsed;
}

/**
 * 189网盘签名算法
 */
function get189Signature(params) {
  // 对参数按key排序并拼接为 key=value 形式
  const sortedKeys = Object.keys(params).sort();
  const sortedParams = sortedKeys.map(key => `${key}=${params[key]}`).join('&');
  
  console.log(`[189] 签名字符串: ${sortedParams}`);
  
  // 计算MD5
  return simpleMD5(sortedParams);
}

/**
 * MD5实现
 */
function simpleMD5(str) {
  function rotateLeft(value, shift) {
    return (value << shift) | (value >>> (32 - shift));
  }
  
  function addUnsigned(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  
  function F(x, y, z) { return (x & y) | (~x & z); }
  function G(x, y, z) { return (x & z) | (y & ~z); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | ~z); }
  
  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function convertToWordArray(str) {
    const lWordCount = ((str.length + 8) >>> 6) + 1;
    const lMessageLength = lWordCount * 16;
    const lWordArray = new Array(lMessageLength - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    
    while (lByteCount < str.length) {
      const lWordIndex = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordIndex] = lWordArray[lWordIndex] | (str.charCodeAt(lByteCount) << lBytePosition);
      lByteCount++;
    }
    
    const lWordIndex = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordIndex] = lWordArray[lWordIndex] | (0x80 << lBytePosition);
    lWordArray[lMessageLength - 2] = str.length << 3;
    lWordArray[lMessageLength - 1] = str.length >>> 29;
    
    return lWordArray;
  }
  
  function wordToHex(value) {
    let result = '';
    for (let i = 0; i <= 3; i++) {
      const byte = (value >>> (i * 8)) & 255;
      result += ('0' + byte.toString(16)).slice(-2);
    }
    return result;
  }
  
  const x = convertToWordArray(str);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    
    a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
    
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    
    a = II(a, b, c, d, x[k + 0], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
    
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}
