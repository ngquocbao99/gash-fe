/**
 * Order Email Notification Utility
 * 
 * Sends order notification emails via EmailJS (same pattern as OTP emails)
 * This is called from the frontend when order notifications are received via Socket.IO
 * 
 * Uses a separate EmailJS template specifically for order notifications.
 * Configuration:
 * - VITE_ENABLE_ORDER_EMAIL_NOTIFICATIONS: Enable/disable order email notifications (default: false)
 * - VITE_EMAILJS_PUBLIC_KEY: EmailJS public key (shared with OTP emails)
 * - VITE_EMAILJS_SERVICE_ID: EmailJS service ID (can be shared or separate)
 * - VITE_EMAILJS_ORDER_TEMPLATE_ID: EmailJS template ID for order notifications
 */

import emailjs from '@emailjs/browser';

// Feature flag to enable/disable order email notifications
// Default ON unless explicitly set to 'false' or '0'
const rawOrderEmailFlag = import.meta.env.VITE_ENABLE_ORDER_EMAIL_NOTIFICATIONS;
const isEnabled =
  rawOrderEmailFlag === undefined ||
  rawOrderEmailFlag === null ||
  rawOrderEmailFlag === ''
    ? true
    : rawOrderEmailFlag === 'true' || rawOrderEmailFlag === '1';

// Initialize EmailJS with Public API Key (shared with OTP emails)
const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
// Use separate template ID for order notifications
const orderTemplateId = import.meta.env.VITE_EMAILJS_ORDER_TEMPLATE_ID;

// Initialize EmailJS if public key is available
if (publicKey && publicKey !== 'your_emailjs_public_key_here') {
  emailjs.init(publicKey);
}

const currencyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

const formatCurrency = (value) => {
  if (value === undefined || value === null) return '';
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return '';
  try {
    return currencyFormatter.format(numericValue);
  } catch {
    return numericValue.toString();
  }
};

const buildOrderItemsPayload = (orderInfo) => {
  if (!orderInfo?.orderDetails || !Array.isArray(orderInfo.orderDetails)) {
    return {
      items: [],
      text: '',
      html: '',
      json: '[]',
    };
  }

  const items = orderInfo.orderDetails
    .map((detail) => {
      const variant = detail?.variant_id || {};
      const productName =
        variant?.productId?.productName ||
        variant?.productName ||
        detail?.productName;
      if (!productName) return null;

      const color =
        variant?.productColorId?.color_name ||
        variant?.color ||
        detail?.color ||
        '';
      const size =
        variant?.productSizeId?.size_name ||
        variant?.size ||
        detail?.size ||
        '';
      const quantity =
        detail?.Quantity ??
        detail?.quantity ??
        detail?.qty ??
        1;
      const unitPrice =
        detail?.UnitPrice ??
        detail?.unitPrice ??
        detail?.price ??
        null;
      const totalPrice =
        detail?.totalPrice ??
        (unitPrice !== null && Number.isFinite(Number(unitPrice))
          ? Number(unitPrice) * Number(quantity || 1)
          : null);

      return {
        name: productName,
        color: color || '',
        size: size || '',
        quantity,
        unitPrice: Number.isFinite(Number(unitPrice)) ? Number(unitPrice) : null,
        totalPrice: Number.isFinite(Number(totalPrice))
          ? Number(totalPrice)
          : null,
      };
    })
    .filter(Boolean);

  const text = items
    .map((item) => {
      const variantParts = [];
      if (item.size) variantParts.push(`Size: ${item.size}`);
      if (item.color) variantParts.push(`Color: ${item.color}`);
      const variantText = variantParts.length ? ` (${variantParts.join(' · ')})` : '';
      const priceText = item.totalPrice !== null ? ` - ${formatCurrency(item.totalPrice)}` : '';
      return `• ${item.name}${variantText} x${item.quantity}${priceText}`;
    })
    .join('\n');

  const html = items.length
    ? `<ul>${items
        .map((item) => {
          const variantParts = [];
          if (item.size) variantParts.push(`Size: ${item.size}`);
          if (item.color) variantParts.push(`Color: ${item.color}`);
          const variantText = variantParts.length
            ? `<small>${variantParts.join(' · ')}</small>`
            : '';
          const priceText =
            item.totalPrice !== null
              ? `<span style="float:right;">${formatCurrency(item.totalPrice)}</span>`
              : '';
          return `<li><strong>${item.name}</strong> ${variantText} × ${item.quantity} ${priceText}</li>`;
        })
        .join('')}</ul>`
    : '';

  return {
    items,
    text,
    html,
    json: JSON.stringify(items),
  };
};

/**
 * Send order notification email via EmailJS
 * @param {Object} params - Email parameters
 * @param {String} params.userEmail - User email address
 * @param {String} params.userName - User name (optional)
 * @param {String} params.title - Email subject/title
 * @param {String} params.message - Email message content
 * @param {String} params.orderId - Order ID for reference (optional)
 * @param {Object} params.orderInfo - Detailed order information (optional)
 * @returns {Promise<Object>} EmailJS response
 */
export async function sendOrderNotificationEmail({
  userEmail,
  userName,
  title,
  message,
  orderId,
  orderInfo = null,
}) {
  // Check if feature is enabled
  if (!isEnabled) {
    // Silently skip - feature is disabled
    return { success: false, message: 'Order email notifications are disabled' };
  }

  // Check if EmailJS is configured
  if (!publicKey || publicKey === 'your_emailjs_public_key_here') {
    console.warn('⚠️ EmailJS not configured. Skipping order notification email.');
    return { success: false, message: 'EmailJS not configured' };
  }

  if (!serviceId || !orderTemplateId) {
    console.warn('⚠️ EmailJS Service ID or Order Template ID missing. Skipping order notification email.');
    console.warn('   Required: VITE_EMAILJS_SERVICE_ID and VITE_EMAILJS_ORDER_TEMPLATE_ID');
    return { success: false, message: 'EmailJS configuration incomplete' };
  }

  if (!userEmail) {
    console.warn('⚠️ User email is missing. Cannot send order notification email.');
    return { success: false, message: 'User email missing' };
  }

  const detailsPayload = orderInfo ? buildOrderItemsPayload(orderInfo) : null;

  // Prepare template parameters (matching EmailJS template variables)
  const templateParams = {
    to_email: userEmail,
    to_name: userName || userEmail.split('@')[0], // Use provided name or extract from email
    subject: title,
    message: message,
    order_id: orderId || orderInfo?._id || '', // Order ID (formatted as #XXXXXXXX if provided)
    order_status: orderInfo?.order_status || orderInfo?.status || '',
    order_payment_status: orderInfo?.pay_status || orderInfo?.payment_status || '',
    order_shipping_address: orderInfo?.addressReceive || orderInfo?.shippingAddress || '',
    order_recipient_name: orderInfo?.name || orderInfo?.recipientName || '',
    order_total_price: formatCurrency(orderInfo?.totalPrice),
    order_discount_amount: formatCurrency(orderInfo?.discountAmount),
    order_final_price: formatCurrency(orderInfo?.finalPrice),
    order_updated_at: orderInfo?.updatedAt
      ? new Date(orderInfo.updatedAt).toLocaleString('vi-VN')
      : '',
    order_details_text: detailsPayload?.text || '',
    order_details_html: detailsPayload?.html || '',
    order_details_json: detailsPayload?.json || '[]',
  };

  try {
    // Send email via EmailJS using the order notification template
    const response = await emailjs.send(
      serviceId,
      orderTemplateId,
      templateParams
    );

    if (response.status === 200) {
    } else {
      console.warn('⚠️ Unexpected EmailJS response status:', response.status);
    }

    return { success: true, response };
  } catch (error) {
    console.error('Error sending order notification email:', error.text || error.message);
    
    // Log helpful error messages for common issues
    if (error.status === 422) {
      console.error('   💡 Template variables mismatch. Check your EmailJS template uses: {{to_email}}, {{to_name}}, {{subject}}, {{message}}, {{order_id}}');
    } else if (error.status === 401) {
      console.error('   💡 Unauthorized - Check your EmailJS public key');
    } else if (error.status === 404) {
      console.error('   💡 Not Found - Check Service ID and Template ID');
    }

    return {
      success: false,
      message: error.text || error.message || 'Failed to send email',
      error: error,
    };
  }
}

/**
 * Extract order ID from notification message
 * @param {String} message - Notification message
 * @returns {String|null} Extracted order ID or null
 */
export function extractOrderIdFromMessage(message) {
  // Look for order ID pattern like #XXXXXXXX in the message
  const match = message.match(/#([a-f0-9]{8})/i);
  return match ? match[1] : null;
}

