import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { Bell, Trash2, Settings, X } from "lucide-react";
import IconButton from "./IconButton";
import { useNavigate } from "react-router-dom";
import { sendOrderNotificationEmail, extractOrderIdFromMessage } from "../utils/orderEmailNotification";
import Api from "../common/SummaryAPI";

const MAX_ORDER_CACHE = 20;

// Shared across all component instances to prevent duplicate emails
// when multiple NotificationsDropdown components are mounted (e.g., mobile + desktop)
const emailedNotificationsSet = new Set();

export default function NotificationsDropdown({ user }) {
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef(null);
  const navigate = useNavigate();

  // 🧩 Socket.IO: kết nối realtime
  const socketRef = useRef(null);
  const orderCacheRef = useRef(new Map());

  const hasDetailedOrderInfo = useCallback((order) => {
    return Boolean(
      order?.orderDetails?.some(
        (detail) => detail?.variant_id?.productId?.productName
      )
    );
  }, []);

  const pruneCacheIfNeeded = useCallback(() => {
    const cache = orderCacheRef.current;
    if (cache.size <= MAX_ORDER_CACHE) return;
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }, []);

  const mergeOrderIntoCache = useCallback((suffixKey, orderData) => {
    if (!suffixKey || !orderData) return;
    const normalizedKey = suffixKey.toLowerCase();
    orderCacheRef.current.set(normalizedKey, orderData);
    pruneCacheIfNeeded();
  }, [pruneCacheIfNeeded]);

  const fetchOrderDataBySuffix = useCallback(
    async (orderIdSuffix) => {
      if (!orderIdSuffix || !user?._id) return null;
      const normalizedSuffix = orderIdSuffix.toString().toLowerCase();
      const cache = orderCacheRef.current;
      const cachedOrder = cache.get(normalizedSuffix);
      if (cachedOrder && hasDetailedOrderInfo(cachedOrder)) {
        return cachedOrder;
      }

      const token = localStorage.getItem("token");
      if (!token) {
        return cachedOrder || null;
      }

      try {
        let orderIdToFetch = cachedOrder?._id;

        if (!orderIdToFetch) {
          const response = await Api.order.getOrders(user._id, token);
          const ordersList = response.data?.data || [];
          const matchedOrder = ordersList.find(
            (orderItem) =>
              orderItem?._id?.slice(-8).toLowerCase() === normalizedSuffix
          );
          if (!matchedOrder) {
            return cachedOrder || null;
          }
          orderIdToFetch = matchedOrder._id;
          mergeOrderIntoCache(normalizedSuffix, matchedOrder);
          if (hasDetailedOrderInfo(matchedOrder)) {
            return matchedOrder;
          }
        }

        if (!orderIdToFetch) {
          return cachedOrder || null;
        }

        const detailedResponse = await Api.order.getOrder(orderIdToFetch, token);
        const detailedOrder = detailedResponse.data?.data;
        if (detailedOrder) {
          mergeOrderIntoCache(normalizedSuffix, detailedOrder);
          return detailedOrder;
        }
      } catch (err) {
        console.error("Failed to fetch order data for email:", err);
      }

      return cachedOrder || null;
    },
    [user, hasDetailedOrderInfo, mergeOrderIntoCache]
  );

  useEffect(() => {
    if (!user?._id) {
      // Cleanup socket if user logs out
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Lấy URL backend chính xác
    const baseURL =
      import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:5000";


    // Create socket if it doesn't exist
    if (!socketRef.current) {
      socketRef.current = io(baseURL, {
        transports: ["websocket", "polling"], // fallback an toàn
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        withCredentials: true,
      });
    }

    const socket = socketRef.current;

    // Khi user kết nối, gửi userId lên server
    const handleConnect = () => {
      // Emit user connection to join notification room
      socket.emit("userConnected", user._id);
    };

    // Nhận thông báo realtime
    const handleNewNotification = (data) => {
      // Add notification to the top of the list
      setNotifications((prev) => {
        // Check if notification already exists to avoid duplicates
        const exists = prev.some(n => n._id === data._id || (n._id?.toString() === data._id?.toString()));
        if (exists) {
          return prev;
        }
        return [data, ...prev];
      });

      // Send email notification if it's an order notification
      // Check if we've already sent an email for this notification to prevent duplicates
      // Use module-level Set to share state across all component instances
      const notificationId = data._id?.toString() || data._id;
      const hasSentEmail = emailedNotificationsSet.has(notificationId);
      
      if (data.type === 'order' && user?.email && !hasSentEmail) {
        // Mark this notification as having triggered an email (shared across all instances)
        emailedNotificationsSet.add(notificationId);
        
        const orderIdSuffix = extractOrderIdFromMessage(data.message);
        (async () => {
          try {
            const orderInfo = orderIdSuffix
              ? await fetchOrderDataBySuffix(orderIdSuffix)
              : null;
            await sendOrderNotificationEmail({
              userEmail: user.email,
              userName: user.name || user.username,
              title: data.title,
              message: data.message,
              orderId: orderInfo?._id || orderIdSuffix,
              orderInfo,
            });
          } catch (err) {
            // On error, remove from set so we can retry if notification comes again
            emailedNotificationsSet.delete(notificationId);
            // Don't show error to user - email is optional
            console.error('Failed to send order notification email:', err);
          }
        })();
      }
    };

    // Listen for badge updates to refresh notification list
    const handleBadgeUpdate = (data) => {
      // Refresh notifications list when badge updates
      const fetchNotifications = async () => {
        try {
          const res = await fetch(
            `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/notifications/user/${user._id}`
          );
          if (!res.ok) throw new Error("Failed to fetch notifications");
          const notificationData = await res.json();
          setNotifications(notificationData);
        } catch (err) {
          console.error("Lỗi khi refresh thông báo:", err);
        }
      };
      fetchNotifications();
    };

    // Listen for deleted notifications to remove them immediately
    const handleNotificationDeleted = (data) => {
      const { notificationId, userId } = data;
      
      if (!notificationId) {
        console.warn("⚠️ notificationDeleted event received without notificationId:", data);
        return;
      }
      
      // If userId is provided and doesn't match current user, ignore (for global notifications this might be null)
      if (userId && user?._id && userId.toString() !== user._id.toString()) {
        return;
      }
      
      // Remove the notification from the list immediately
      setNotifications((prev) => {
        const filtered = prev.filter((n) => {
          const nId = n._id?.toString() || n._id;
          const deletedId = notificationId?.toString() || notificationId;
          const shouldKeep = nId !== deletedId;
          return shouldKeep;
        });
        
        if (filtered.length === prev.length) {
          console.warn(`⚠️ Notification with ID ${notificationId} not found in current list, refreshing...`);
          // Fallback: refresh the list if notification not found (might be a race condition)
          setTimeout(() => {
            const fetchNotifications = async () => {
              try {
                const res = await fetch(
                  `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/notifications/user/${user._id}`
                );
                if (!res.ok) throw new Error("Failed to fetch notifications");
                const notificationData = await res.json();
                setNotifications(notificationData);
              } catch (err) {
                console.error("Lỗi khi refresh thông báo:", err);
              }
            };
            fetchNotifications();
          }, 500);
        }
        
        return filtered;
      });
    };

    // Listen to order updates to hydrate cache for mailing details
    const handleOrderUpdated = (payload) => {
      const updatedOrder = payload?.order || payload;
      const orderId = updatedOrder?._id;
      if (!orderId) return;
      const suffixKey = orderId.slice(-8).toLowerCase();
      mergeOrderIntoCache(suffixKey, updatedOrder);
    };

    // Log lỗi
    const handleConnectError = (err) => {
      console.error("Notification Socket connection error:", err.message);
    };

    // Ngắt kết nối
    const handleDisconnect = (reason) => {
      console.warn("⚠️ Notification Socket disconnected:", reason);
    };

    // Set up event listeners
    socket.on("connect", handleConnect);
    socket.on("newNotification", handleNewNotification);
    socket.on("notificationBadgeUpdate", handleBadgeUpdate);
    socket.on("notificationDeleted", handleNotificationDeleted);
    socket.on("orderUpdated", handleOrderUpdated);
    socket.on("connect_error", handleConnectError);
    socket.on("disconnect", handleDisconnect);

    // If already connected, emit userConnected immediately
    if (socket.connected) {
      socket.emit("userConnected", user._id);
    }

    // Re-join rooms on reconnect
    const handleReconnect = () => {
      socket.emit("userConnected", user._id);
    };
    socket.on("reconnect", handleReconnect);
    
    return () => {
      socket.off("connect", handleConnect);
      socket.off("newNotification", handleNewNotification);
      socket.off("notificationBadgeUpdate", handleBadgeUpdate);
      socket.off("notificationDeleted", handleNotificationDeleted);
      socket.off("orderUpdated", handleOrderUpdated);
      socket.off("reconnect", handleReconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("disconnect", handleDisconnect);
      // Don't disconnect here - keep socket alive for component lifecycle
    };
  }, [user, fetchOrderDataBySuffix, mergeOrderIntoCache]);

  // 🧠 Lấy danh sách thông báo từ backend
  useEffect(() => {
    const fetchNotifications = async () => {
      if (!user?._id) return;
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/notifications/user/${user._id}`
        );
        if (!res.ok) throw new Error("Failed to fetch notifications");
        const data = await res.json();
        setNotifications(data);
      } catch (err) {
        console.error("Lỗi khi lấy thông báo:", err);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // refresh mỗi 30s
    return () => clearInterval(interval);
  }, [user]);

  // 🧱 Click ngoài để đóng dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 🔢 Số lượng chưa đọc
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Đánh dấu đã đọc
  const markAsRead = async (id) => {
    try {
      await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/notifications/mark-read/${id}`,
        { method: "PUT" }
      );
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error("Lỗi khi đánh dấu đã đọc:", err);
    }
  };

  // Xóa 1 thông báo (cho user)
  const deleteNotification = async (id) => {
    try {
      await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/notifications/user/${user._id}/${id}`,
        { method: "DELETE" }
      );
      setNotifications((prev) => prev.filter((n) => n._id !== id));
    } catch (err) {
      console.error("Lỗi khi xóa thông báo:", err);
    }
  };

  // 🧹 Xóa toàn bộ thông báo
  const clearAll = async () => {
    try {
      await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/notifications/clear/${user._id}`,
        { method: "DELETE" }
      );
      setNotifications([]);
    } catch (err) {
      console.error("Lỗi khi clear all:", err);
    }
  };

  return (
    <div className="relative" ref={notificationRef}>
      {/* 🔔 Icon chuông */}
      <IconButton
        onClick={() => (user ? setShowNotifications((prev) => !prev) : navigate("/login"))}
        title="Notifications"
        badge={unreadCount > 0 ? unreadCount : undefined}
      >
        <Bell className="w-5 h-5" />
      </IconButton>

      {/* 📜 Dropdown danh sách */}
      {user && showNotifications && (
        <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white text-gray-900 rounded-xl shadow-lg overflow-hidden z-50 border-2 border-gray-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-gray-50 border-b-2 border-gray-200">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center gap-2">
              <button
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                title="Notification Settings"
                onClick={() => {
                  setShowNotifications(false);
                  navigate("/notifications");
                }}
                aria-label="Notification Settings"
              >
                <Settings className="w-4 h-4" />
              </button>

              {notifications.length > 0 && (
                <button
                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  onClick={clearAll}
                  title="Clear all notifications"
                  aria-label="Clear all notifications"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Danh sách */}
          {notifications.length > 0 ? (
            <ul className="max-h-96 overflow-y-auto divide-y divide-gray-200">
              {notifications.map((n) => (
                <li
                  key={n._id}
                  onClick={() => {
                    markAsRead(n._id);
                    // Navigate to livestream if it's a livestream notification
                    if (n.type === 'livestream' && n.livestreamId) {
                      setShowNotifications(false);
                      navigate(`/live/${n.livestreamId}`);
                    }
                  }}
                  className={`group flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                    !n.isRead ? "bg-amber-50/50" : "bg-white"
                  }`}
                >
                  <div className={`flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center self-center ${
                    !n.isRead ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-600"
                  }`}>
                    <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 text-sm sm:text-base leading-snug mb-1">
                      <strong className="font-semibold">{n.title}</strong>
                    </p>
                    <p className="text-gray-600 text-xs sm:text-sm mb-2 whitespace-pre-wrap">
                      {n.message}
                    </p>

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>
                        {new Date(n.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        {new Date(n.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <button
                    className="ml-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors flex-shrink-0 self-center flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(n._id);
                    }}
                    title="Delete notification"
                    aria-label="Delete notification"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-gray-500 text-sm">
              <Bell className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p>No new notifications</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
