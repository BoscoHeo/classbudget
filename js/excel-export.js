/**
 * excel-export.js - NEIS 정산 양식 엑셀 파일 생성
 * Pure JS CSV export (works without external libraries)
 */

const ExcelExport = (() => {

  /**
   * Format number with commas
   */
  function formatNumber(num) {
    return Number(num).toLocaleString('ko-KR');
  }

  /**
   * Format date for display
   */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Get category name by id
   */
  function getCategoryName(categoryId) {
    const cat = Storage.CATEGORIES.find(c => c.id === categoryId);
    return cat ? cat.name : '기타';
  }

  /**
   * Generate NEIS-style settlement CSV
   */
  function generateSettlementCSV(receipts, settings) {
    const totalSpent = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const remaining = settings.totalBudget - totalSpent;

    // BOM for UTF-8 Korean support in Excel
    let csv = '\uFEFF';

    // Title
    csv += `"학급운영비 개산급 집행정산서"\n`;
    csv += `\n`;

    // Summary info
    csv += `"건명","${settings.budgetName || '학급운영비'}"\n`;
    if (settings.schoolName) csv += `"학교명","${settings.schoolName}"\n`;
    if (settings.className) csv += `"학급","${settings.className}"\n`;
    if (settings.teacherName) csv += `"담당교사","${settings.teacherName}"\n`;
    csv += `"정산일","${formatDate(new Date().toISOString())}"\n`;
    csv += `\n`;

    // Budget summary
    csv += `"구분","금액"\n`;
    csv += `"수령액(A)","${formatNumber(settings.totalBudget)}원"\n`;
    csv += `"집행액(B)","${formatNumber(totalSpent)}원"\n`;
    csv += `"잔액(A-B)","${formatNumber(remaining)}원"\n`;
    csv += `\n`;

    // Detail header
    csv += `"번호","사용날짜","사용처","사용목적(품명)","분류","사용금액","비고"\n`;

    // Detail rows
    const sorted = [...receipts].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((r, i) => {
      const row = [
        i + 1,
        `"${formatDate(r.date)}"`,
        `"${(r.store || '').replace(/"/g, '""')}"`,
        `"${(r.item || '').replace(/"/g, '""')}"`,
        `"${getCategoryName(r.category)}"`,
        `"${formatNumber(r.amount)}원"`,
        `"${(r.memo || '').replace(/"/g, '""')}"`,
      ];
      csv += row.join(',') + '\n';
    });

    // Total row
    csv += `\n`;
    csv += `"","","","","합계","${formatNumber(totalSpent)}원",""\n`;

    return csv;
  }

  /**
   * Generate and download NEIS settlement file
   */
  function downloadSettlement() {
    const receipts = Storage.getReceipts();
    const settings = Storage.getSettings();

    if (receipts.length === 0) {
      return { success: false, error: '내보낼 영수증이 없습니다.' };
    }

    const csv = generateSettlementCSV(receipts, settings);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    a.download = `학급비_정산_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, count: receipts.length };
  }

  /**
   * Generate K-에듀파인 정산양식 XLS file
   * Columns: 사용일자, 사용업체명, 사용금액, 구입구분, 사용내역
   * Sheet name: 정산양식
   */
  function downloadEdufineXLS() {
    const receipts = Storage.getReceipts();
    if (receipts.length === 0) {
      return { success: false, error: '내보낼 영수증이 없습니다.' };
    }

    const sorted = [...receipts].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Build HTML table that Excel can open as .xls
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<!--[if gte mso 9]>
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>
<x:ExcelWorksheet>
<x:Name>정산양식</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet>
</x:ExcelWorksheets>
</x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  td, th { mso-number-format:"\\@"; }
  .num { mso-number-format:"#,##0"; }
</style>
</head>
<body>
<table border="1">
<thead>
<tr style="background:#4472C4;color:#fff;font-weight:bold;">
<th>사용일자</th>
<th>사용업체명</th>
<th>사용금액</th>
<th>구입구분</th>
<th>사용내역</th>
</tr>
</thead>
<tbody>`;

    sorted.forEach(r => {
      const date = formatDate(r.date);
      const store = (r.store || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const amount = Number(r.amount) || 0;
      const category = getCategoryName(r.category);
      const item = (r.item || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const memo = r.memo ? ` (${r.memo.replace(/</g, '&lt;').replace(/>/g, '&gt;')})` : '';

      html += `
<tr>
<td>${date}</td>
<td>${store}</td>
<td class="num">${amount}</td>
<td>${category}</td>
<td>${item}${memo}</td>
</tr>`;
    });

    html += `
</tbody>
</table>
</body>
</html>`;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    a.download = `정산내역_${dateStr}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, count: receipts.length };
  }

  /**
   * Download simple receipt list as CSV
   */
  function downloadReceiptList() {
    const receipts = Storage.getReceipts();
    if (receipts.length === 0) {
      return { success: false, error: '내보낼 영수증이 없습니다.' };
    }

    let csv = '\uFEFF';
    csv += `"번호","날짜","사용처","품명","분류","금액","메모"\n`;

    const sorted = [...receipts].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((r, i) => {
      csv += [
        i + 1,
        `"${formatDate(r.date)}"`,
        `"${(r.store || '').replace(/"/g, '""')}"`,
        `"${(r.item || '').replace(/"/g, '""')}"`,
        `"${getCategoryName(r.category)}"`,
        `"${formatNumber(r.amount)}"`,
        `"${(r.memo || '').replace(/"/g, '""')}"`,
      ].join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `영수증_목록_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, count: receipts.length };
  }

  return {
    downloadSettlement,
    downloadEdufineXLS,
    downloadReceiptList,
    formatNumber,
    formatDate,
  };
})();
