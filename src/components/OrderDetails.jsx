import React, { useEffect, useState, useCallback, useContext, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../common/axiosClient";
import Api from "../common/SummaryAPI";
import { useToast } from "../hooks/useToast";
import FeedbackForm from "./FeedbackForm";
import LoadingSpinner, { LoadingForm, LoadingButton } from "./LoadingSpinner";
import ImageModal from "./ImageModal";
import ProductButton from "./ProductButton";
import ConfirmationModal from "./ConfirmationModal";

const OrderDetailsModal = ({ orderId, onClose }) => {
    const { showToast } = useToast();
    const navigate = useNavigate();
    const { user } = useContext(AuthContext);

    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [existingFeedbacks, setExistingFeedbacks] = useState({});
    const [selectedImage, setSelectedImage] = useState(null);
    const [loadingStates, setLoadingStates] = useState({
        submitting: {},
        editing: {},
        deleting: {}
    });
    const [showViewFeedbackModal, setShowViewFeedbackModal] = useState(false);
    const [showEditFeedbackModal, setShowEditFeedbackModal] = useState(false);
    const [showDeleteFeedbackConfirm, setShowDeleteFeedbackConfirm] = useState(false);
    const [selectedVariantId, setSelectedVariantId] = useState(null);
    const [selectedProductName, setSelectedProductName] = useState('');

    // VNPay countdown timer state
    const [timeLeft, setTimeLeft] = useState(null);
    const [isVNPayExpired, setIsVNPayExpired] = useState(false);

    const socketRef = useRef(null);

    // 🧭 Fetch order with all details
    const fetchOrderDetails = useCallback(async () => {
        try {
            const token = localStorage.getItem("token");

            const response = await Api.order.getOrder(orderId, token);

            // The API returns the complete order data in response.data.data
            const orderData = response.data.data;

            setOrder(orderData);
        } catch (err) {
            showToast(err.message || "Failed to load order details", "error");
        } finally {
            setLoading(false);
        }
    }, [orderId, showToast]);

    // 🔍 Extract feedbacks from order data (READ-ONLY operation - only affects display)
    const extractFeedbacksFromOrder = useCallback(() => {
        if (!order?.orderDetails?.length) {
            setExistingFeedbacks({});
            return;
        }

        const feedbackMap = {};

        // Extract feedbacks from orderDetails
        order.orderDetails.forEach((detail, index) => {
            // Use index as key when variant is null, or variant._id when available
            const key = detail.variant?._id || `item_${index}`;

            if (detail.feedback) {
                // Check if feedback has rating or content (using flags from backend)
                const hasRating = detail.feedback.has_rating === true &&
                    detail.feedback.rating !== null &&
                    detail.feedback.rating !== undefined;

                const hasContent = detail.feedback.has_content === true &&
                    detail.feedback.content &&
                    detail.feedback.content.trim() !== '' &&
                    detail.feedback.content !== 'This feedback has been deleted by staff/admin';

                // Include feedback if it has rating OR content and is not deleted
                if ((hasContent || hasRating) && !detail.feedback.is_deleted) {
                    feedbackMap[key] = {
                        rating: detail.feedback.rating,
                        content: detail.feedback.content,
                        has_rating: hasRating,
                        has_content: hasContent,
                        is_deleted: false,
                        created_at: detail.feedback.created_at,
                        updated_at: detail.feedback.updated_at
                    };
                }
            }
        });

        setExistingFeedbacks(feedbackMap);
    }, [order?.orderDetails]);

    useEffect(() => {
        if (orderId) fetchOrderDetails();
    }, [orderId, fetchOrderDetails]);

    // Extract feedbacks when order data is loaded or updated
    useEffect(() => {
        if (order?.orderDetails) {
            extractFeedbacksFromOrder();
        }
    }, [order?.orderDetails, extractFeedbacksFromOrder]);

    useEffect(() => {
        if (order?.payment_method === 'VNPAY' && order?.pay_status === 'unpaid' && order?.vnpay_expiry_time) {
            const expiryTime = new Date(order.vnpay_expiry_time);
            const now = new Date();

            if (expiryTime > now) {
                // Calculate initial time left in seconds
                const initialTimeLeft = Math.floor((expiryTime - now) / 1000);
                setTimeLeft(initialTimeLeft);
                setIsVNPayExpired(false);

                // Start countdown timer
                const timer = setInterval(() => {
                    setTimeLeft(prev => {
                        if (prev <= 1) {
                            setIsVNPayExpired(true);
                            clearInterval(timer);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);

                return () => clearInterval(timer);
            } else {
                // Already expired
                setTimeLeft(0);
                setIsVNPayExpired(true);
            }
        } else {
            setTimeLeft(null);
            setIsVNPayExpired(false);
        }
    }, [order]);

    // Setup Socket.IO for real-time order updates
    useEffect(() => {
        if (!user?._id || !orderId) return;

        // Initialize socket if not already created
        if (!socketRef.current) {
            const token = localStorage.getItem("token");
            socketRef.current = io(SOCKET_URL, {
                transports: ["websocket", "polling"],
                auth: { token },
                withCredentials: true,
            });
        }

        const socket = socketRef.current;

        // Connect and authenticate
        socket.on("connect", () => {
            console.log("OrderDetails Socket connected:", socket.id);
            // Emit user connection
            socket.emit("userConnected", user._id);
            // Also try authentication if token available
            const token = localStorage.getItem("token");
            if (token) {
                socket.emit("authenticate", token);
            }
        });

        // Listen for order updates
        socket.on("orderUpdated", (payload) => {
            const updatedOrder = payload.order || payload;
            const orderUserId = payload.userId || updatedOrder.acc_id?._id || updatedOrder.acc_id;

            // Only update if this order belongs to the current user and matches the current orderId
            if (orderUserId && orderUserId.toString() === user._id.toString() && updatedOrder._id === orderId) {
                console.log("📦 Order updated via Socket.IO in OrderDetails:", updatedOrder._id);

                // Update the order state while preserving populated orderDetails structure
                setOrder((prevOrder) => {
                    if (!prevOrder) return updatedOrder;

                    // Check if updated order has properly populated orderDetails
                    const hasPopulatedDetails = updatedOrder.orderDetails?.some(
                        (detail) => detail?.variant_id?.productId?.productName
                    );

                    // Preserve existing orderDetails if updated order doesn't have populated ones
                    const preservedOrderDetails = hasPopulatedDetails
                        ? updatedOrder.orderDetails
                        : prevOrder.orderDetails;

                    return {
                        ...prevOrder,
                        ...updatedOrder,
                        // Preserve populated orderDetails structure
                        orderDetails: preservedOrderDetails || updatedOrder.orderDetails || prevOrder.orderDetails,
                    };
                });
            }
        });

        // Cleanup on unmount
        return () => {
            socket.off("connect");
            socket.off("orderUpdated");
        };
    }, [user?._id, orderId]);

    useEffect(() => {
        extractFeedbacksFromOrder();
    }, [order, extractFeedbacksFromOrder]);

    const formatPrice = (p) =>
        p?.toLocaleString("vi-VN", { style: "currency", currency: "VND" });

    // Cancel order
    const handleCancelOrder = async () => {
        setShowConfirmModal(true);
    };

    // 📝 Send feedback
    const handleFeedback = async (variantId, comment, rating) => {
        setLoadingStates(prev => ({
            ...prev,
            submitting: { ...prev.submitting, [variantId]: true }
        }));

        // Add timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            setLoadingStates(prev => ({
                ...prev,
                submitting: { ...prev.submitting, [variantId]: false }
            }));
        }, 10000); // 10 second timeout

        try {
            const token = localStorage.getItem("token");

            // Validate parameters before making API call
            if (!orderId) {
                throw new Error("Order ID is missing");
            }
            if (!variantId) {
                throw new Error("Variant ID is missing");
            }
            if (!token) {
                throw new Error("Authentication token is missing");
            }
            // Backend now requires rating to be mandatory
            if (!rating) {
                throw new Error("Rating is required");
            }
            if (rating < 1 || rating > 5) {
                throw new Error("Rating must be between 1 and 5");
            }
            if (comment && comment.length > 500) {
                throw new Error("Comment cannot exceed 500 characters");
            }

            const feedbackData = {
                rating: parseInt(rating),
                content: comment ? comment.trim() : null
            };

            // For items without variant, use the orderDetail index
            const actualVariantId = variantId.startsWith('item_') ? null : variantId;

            await Api.feedback.addFeedback(
                orderId,
                actualVariantId,
                feedbackData,
                token
            );

            // Show success message after API call succeeds
            showToast("Feedback created successfully", "success");

            // Refresh order data to get updated feedback
            await fetchOrderDetails();

            setShowEditFeedbackModal(false);
        } catch (err) {
            // Show more specific error message
            let errorMessage = "Failed to create feedback";

            if (err.response?.data?.message) {
                errorMessage = err.response.data.message;
            } else if (err.response?.status === 500) {
                errorMessage = "Server error - please try again later";
            } else if (err.response?.status === 400) {
                errorMessage = "Invalid request - please check your input";
            } else if (err.response?.status === 404) {
                errorMessage = "Order or product not found";
            } else if (err.message) {
                errorMessage = err.message;
            }

            showToast(errorMessage, "error");
        } finally {
            clearTimeout(timeoutId);
            setLoadingStates(prev => ({
                ...prev,
                submitting: { ...prev.submitting, [variantId]: false }
            }));
        }
    };

    // Edit feedback
    const handleEditFeedback = async (variantId, comment, rating) => {
        setLoadingStates(prev => ({
            ...prev,
            editing: { ...prev.editing, [variantId]: true }
        }));

        // Add timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            setLoadingStates(prev => ({
                ...prev,
                editing: { ...prev.editing, [variantId]: false }
            }));
        }, 10000); // 10 second timeout

        try {
            const token = localStorage.getItem("token");

            // Validate parameters before making API call
            if (!orderId) {
                throw new Error("Order ID is missing");
            }
            if (!variantId) {
                throw new Error("Variant ID is missing");
            }
            if (!token) {
                throw new Error("Authentication token is missing");
            }
            // Backend now requires rating to be mandatory
            if (!rating) {
                throw new Error("Rating is required");
            }
            if (rating < 1 || rating > 5) {
                throw new Error("Rating must be between 1 and 5");
            }
            if (comment && comment.length > 500) {
                throw new Error("Comment cannot exceed 500 characters");
            }

            const feedbackData = {
                rating: parseInt(rating),
                content: comment ? comment.trim() : null
            };

            // For items without variant, use the orderDetail index
            const actualVariantId = variantId.startsWith('item_') ? null : variantId;

            await Api.feedback.editFeedback(
                orderId,
                actualVariantId,
                feedbackData,
                token
            );

            // Show success notification after API call succeeds
            showToast("Feedback updated successfully", "success");

            // Refresh order data to get updated feedback
            await fetchOrderDetails();

            setShowEditFeedbackModal(false);
        } catch (err) {
            // Show more specific error message
            let errorMessage = "Failed to update feedback";

            if (err.response?.data?.message) {
                errorMessage = err.response.data.message;
            } else if (err.response?.status === 500) {
                errorMessage = "Server error - please try again later";
            } else if (err.response?.status === 400) {
                errorMessage = "Invalid request - please check your input";
            } else if (err.response?.status === 404) {
                errorMessage = "Order or product not found";
            } else if (err.message) {
                errorMessage = err.message;
            }

            showToast(errorMessage, "error");
        } finally {
            clearTimeout(timeoutId);
            setLoadingStates(prev => ({
                ...prev,
                submitting: { ...prev.submitting, [variantId]: false }
            }));
        }
    };

    const handleViewFeedback = (variantId, productName) => {
        setSelectedVariantId(variantId);
        setSelectedProductName(productName);
        setShowViewFeedbackModal(true);
    };

    const handleEditFeedbackClick = (variantId, productName) => {
        setSelectedVariantId(variantId);
        setSelectedProductName(productName);
        setShowEditFeedbackModal(true);
    };

    // Delete feedback
    const handleDeleteFeedback = useCallback(async () => {
        setShowDeleteFeedbackConfirm(false);
        setLoadingStates(prev => ({
            ...prev,
            deleting: { ...prev.deleting, [selectedVariantId]: true }
        }));

        try {
            const token = localStorage.getItem("token");

            if (!orderId) {
                throw new Error("Order ID is missing");
            }
            if (!selectedVariantId) {
                throw new Error("Variant ID is missing");
            }
            if (!token) {
                throw new Error("Authentication token is missing");
            }

            const actualVariantId = selectedVariantId.startsWith('item_') ? null : selectedVariantId;

            await Api.feedback.deleteFeedback(orderId, actualVariantId, token);

            showToast("Feedback deleted successfully", "success");

            // Refresh order data to get updated feedback
            await fetchOrderDetails();

            setShowEditFeedbackModal(false);
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message || "Failed to delete feedback";
            showToast(errorMessage, "error");
        } finally {
            setLoadingStates(prev => ({
                ...prev,
                deleting: { ...prev.deleting, [selectedVariantId]: false }
            }));
        }
    }, [orderId, selectedVariantId, showToast, fetchOrderDetails]);

    const getStatusBadge = (status, type = "order") => {
        const base =
            "inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium";

        // Debug logging

        if (type === "order") {
            // Clean the status string
            const cleanStatus = status?.toString().trim().toLowerCase();
            const capitalizeFirst = (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

            switch (cleanStatus) {
                case "pending":
                    return (
                        <span className={`${base} bg-yellow-100 text-yellow-800`}>
                            Pending
                        </span>
                    );
                case "confirmed":
                    return (
                        <span className={`${base} bg-blue-100 text-blue-800`}>
                            Confirmed
                        </span>
                    );
                case "shipping":
                    return (
                        <span className={`${base} bg-indigo-100 text-indigo-800`}>
                            Shipping
                        </span>
                    );
                case "delivered":
                    return (
                        <span className={`${base} bg-green-100 text-green-800`}>
                            Delivered
                        </span>
                    );
                case "cancelled":
                    return (
                        <span className={`${base} bg-red-100 text-red-800`}>
                            Cancelled
                        </span>
                    );
                default:
                    return (
                        <span className={`${base} bg-gray-100 text-gray-800`}>
                            {capitalizeFirst(status || 'Unknown')}
                        </span>
                    );
            }
        } else if (type === "pay") {
            const capitalizeFirst = (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

            switch (status?.toLowerCase()) {
                case "unpaid":
                    return (
                        <span className={`${base} bg-orange-100 text-orange-800`}>
                            Unpaid
                        </span>
                    );
                case "paid":
                    return (
                        <span className={`${base} bg-green-100 text-green-800`}>
                            Paid
                        </span>
                    );
                case "refunded":
                    return (
                        <span className={`${base} bg-purple-100 text-purple-800`}>
                            Refunded
                        </span>
                    );
                default:
                    return (
                        <span className={`${base} bg-gray-100 text-gray-800`}>
                            {capitalizeFirst(status || 'Unknown')}
                        </span>
                    );
            }
        } else if (type === "refund") {
            const capitalizeFirst = (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

            switch (status?.toLowerCase()) {
                case "pending_refund":
                    return (
                        <span className={`${base} bg-yellow-100 text-yellow-800`}>
                            Pending Refund
                        </span>
                    );
                case "refunded":
                    return (
                        <span className={`${base} bg-green-100 text-green-800`}>
                            Refunded
                        </span>
                    );
                case "not_applicable":
                    return (
                        <span className={`${base} bg-gray-100 text-gray-800`}>
                            Not Applicable
                        </span>
                    );
                default:
                    return (
                        <span className={`${base} bg-gray-100 text-gray-800`}>
                            {capitalizeFirst(status || '')}
                        </span>
                    );
            }
        }
    };

    const [cancelFormData, setCancelFormData] = useState({
        cancelReason: "",
        customReason: ""
    });
    const [error, setError] = useState("");

    const handleSubmitCancel = async () => {
        if (!cancelFormData.cancelReason) {
            setError("Please select a cancellation reason");
            return;
        }
        if (cancelFormData.cancelReason === "other" && !cancelFormData.customReason.trim()) {
            setError("Please provide a custom reason");
            return;
        }
        if (cancelFormData.cancelReason === "other" && cancelFormData.customReason.length > 500) {
            setError("Custom reason cannot exceed 500 characters");
            return;
        }
        try {
            const token = localStorage.getItem("token");
            const reason = cancelFormData.cancelReason === "other"
                ? cancelFormData.customReason
                : cancelFormData.cancelReason;
            console.log("Sending cancel request with reason:", reason); // Debug log
            await Api.order.cancel(orderId, reason, token);
            showToast("Order cancelled successfully", "success");
            fetchOrderDetails();
            setShowConfirmModal(false);
        } catch (err) {
            console.error("Cancel error:", err.response?.data); // Log error details
            setError(err.message || "Failed to cancel order");
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-3xl max-h-[85vh] overflow-y-auto relative"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 text-2xl font-bold transition-colors focus:outline-none rounded"
                >
                    ×
                </button>

                {loading ? (
                    <LoadingForm text="Loading order details..." height="h-64" size="lg" />
                ) : !order ? (
                    <div className="text-center py-12">
                        <div className="text-red-400 mb-4">
                            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        </div>
                        <p className="text-red-500 text-lg font-medium">Order not found</p>
                        <p className="text-gray-400 text-sm mt-2">The order you're looking for doesn't exist or has been removed</p>
                    </div>
                ) : (
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl sm:text-2xl font-normal text-gray-900">
                                Order #{order._id}
                            </h2>
                            {/* View Bill button in header - only show if order is paid */}
                            {order.pay_status?.toLowerCase() === 'paid' && (
                                <ProductButton
                                    variant="default"
                                    size="md"
                                    onClick={() => {
                                        onClose(); // Close the modal first
                                        navigate(`/bills/${orderId}`); // Then navigate to bill
                                    }}
                                    title="View Bill"
                                    className="text-green-600 flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    View Bill
                                </ProductButton>
                            )}
                        </div>

                        {/* Order Status Card */}
                        <div className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-6 transition-shadow hover:shadow-sm">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-3 text-sm">
                                    <span className="text-gray-600 font-medium">Order Status:</span>
                                    {getStatusBadge(order.order_status, "order")}
                                    <span className="text-gray-600 font-medium">Payment:</span>
                                    {getStatusBadge(order.pay_status, "pay")}
                                </div>
                                <span className="text-sm text-gray-500">
                                    Placed on {new Date(order.orderDate || order.createdAt).toLocaleDateString('vi-VN')}
                                </span>
                            </div>

                            {/* Cancel Reason (if cancelled) */}
                            {order.order_status?.toLowerCase() === "cancelled" && order.cancelReason && (
                                <div className="mt-4 pt-4 border-t border-gray-200">
                                    <span className="text-gray-600 font-medium">Cancellation Reason:</span>
                                    <p className="mt-1 text-gray-700">{order.cancelReason}</p>
                                </div>
                            )}
                        </div>

                        {/* VNPay Payment Countdown */}
                        {order?.payment_method === 'VNPAY' && order?.pay_status === 'unpaid' && order?.order_status !== 'cancelled' && (
                            <div className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-6 transition-shadow hover:shadow-sm">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="flex flex-col gap-2">
                                        <h3 className="text-lg font-semibold text-gray-900">VNPay Payment</h3>
                                        {timeLeft !== null && !isVNPayExpired && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-gray-600">Time remaining:</span>
                                                <span className={`text-lg font-mono font-bold ${timeLeft < 300 ? 'text-red-600' : timeLeft < 600 ? 'text-orange-600' : 'text-green-600'
                                                    }`}>
                                                    {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                                                </span>
                                            </div>
                                        )}
                                        {isVNPayExpired && (
                                            <div className="text-red-600 font-medium">
                                                Payment time expired. Order will be cancelled automatically.
                                            </div>
                                        )}
                                    </div>
                                    {!isVNPayExpired && order?.vnpay_payment_url && (
                                        <ProductButton
                                            variant="primary"
                                            size="md"
                                            onClick={() => window.open(order.vnpay_payment_url, '_blank')}
                                            className="flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                            Continue VNPay Payment
                                        </ProductButton>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Customer & Payment Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 transition-shadow hover:shadow-sm focus-within:shadow-sm">
                                <h4 className="text-lg font-semibold text-gray-900 mb-3">Customer Information</h4>
                                <div className="space-y-2 text-sm">
                                    <p className="text-gray-700">
                                        <span className="font-medium">Name:</span> {order.customer?.name || order.customer?.username}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">Phone:</span> {order.phone}
                                    </p>
                                    <p className="text-gray-600">
                                        <span className="font-medium">Address:</span> {order.addressReceive}
                                    </p>
                                </div>
                            </div>

                            <div className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-4 transition-shadow hover:shadow-sm focus-within:shadow-sm">
                                <h4 className="text-sm sm:text-base font-semibold text-gray-900 mb-3">Payment Information</h4>
                                <div className="space-y-2 text-sm">
                                    <p className="text-gray-700">
                                        <span className="font-medium">Method:</span> {order.payment_method}
                                    </p>
                                    {order.voucher && (
                                        <p className="text-blue-600 font-medium">
                                            <span className="font-medium">Voucher Applied:</span> {order.voucher.code}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Price Summary */}
                        <div className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-6 transition-shadow hover:shadow-sm focus-within:shadow-sm">
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h4>
                            <div className="space-y-3">
                                {order.summary && (
                                    <div className="flex justify-between text-sm text-gray-600">
                                        <span className="font-medium">Items:</span>
                                        <span>{order.summary.totalItems} item(s) • {order.summary.totalQuantity} qty</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-gray-700">
                                    <span>Subtotal:</span>
                                    <span className="font-medium">{formatPrice(order.totalPrice)}</span>
                                </div>
                                {order.discountAmount > 0 && (
                                    <div className="flex justify-between text-green-600 font-medium">
                                        <span>Discount:</span>
                                        <span>-{formatPrice(order.discountAmount)}</span>
                                    </div>
                                )}
                                <hr className="border-gray-200" />
                                <div className="flex justify-between items-center text-lg">
                                    <span className="font-bold text-gray-900">Total Amount:</span>
                                    <span className="font-bold text-xl text-red-600">{formatPrice(order.finalPrice)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Products */}
                        <div className="space-y-3">
                            <h4 className="text-xl sm:text-2xl font-normal text-gray-900 mb-4">Order Items</h4>
                            {order.orderDetails && order.orderDetails.length > 0 ? (
                                order.orderDetails.map((d, index) => {
                                    const feedbackKey = d.variant?._id || `item_${index}`;
                                    const stockQuantity = d.variant?.stockQuantity ?? 0;
                                    const isOutOfStock = stockQuantity <= 0;
                                    const isDiscontinued =
                                        d.variant?.variantStatus === "discontinued" ||
                                        d.variant?.product?.productStatus === "discontinued";
                                    return (
                                        <article
                                            key={d._id}
                                            className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-4 last:mb-0 flex flex-col sm:flex-row gap-4 transition-shadow hover:shadow-sm border border-gray-200 focus-within:shadow-sm"
                                            tabIndex={0}
                                            aria-label={`Order Item: ${d.variant?.product?.name || "Product"}`}
                                        >
                                            <div className="flex items-stretch gap-6 flex-1">
                                                {/* Image */}
                                                <img
                                                    src={d.variant?.image || "/placeholder.png"}
                                                    alt={d.variant?.product?.name || "Product"}
                                                    className="w-20 sm:w-24 aspect-square object-cover rounded-lg flex-shrink-0"
                                                    onClick={() =>
                                                        setSelectedImage({
                                                            src: d.variant?.image || "/placeholder.png",
                                                            alt: d.variant?.product?.name || "Product",
                                                        })
                                                    }
                                                />
                                                {/* Product Info */}
                                                <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-base sm:text-lg font-semibold text-gray-900 m-0 line-clamp-2">
                                                            {d.variant?.product?.name || "Product"}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-sm text-gray-600 m-0">
                                                            Color: {d.variant?.color?.name || "N/A"}  •  Size: {d.variant?.size?.name || "N/A"}
                                                        </p>
                                                    </div>
                                                    <p className="text-sm text-gray-600 m-0">Unit Price: {formatPrice(d.unitPrice)}</p>
                                                    {(isOutOfStock || isDiscontinued) && (
                                                        <p className="text-sm font-semibold text-red-600">
                                                            {isDiscontinued ? "Discontinued" : "Out of Stock"}
                                                        </p>
                                                    )}
                                                    <p className="text-base font-semibold text-red-600 m-0 mt-1">Total: {formatPrice(d.totalPrice)}</p>
                                                </div>
                                            </div>
                                            {/* Quantity and Feedback Buttons */}
                                            <div className="flex flex-row sm:flex-col items-center sm:items-center sm:justify-center gap-3 sm:gap-4">
                                                <div className="flex items-center justify-center">
                                                    <div className="px-4 py-2 bg-gray-100 rounded-lg text-center min-w-20">
                                                        <span className="text-sm text-gray-600">Qty</span>
                                                        <p className="text-lg font-semibold text-gray-900">{d.quantity}</p>
                                                    </div>
                                                </div>
                                                {/* Feedback Buttons – Only if Delivered */}
                                                {order.order_status?.toLowerCase() === "delivered" && (
                                                    <div className="flex gap-2">
                                                        <ProductButton
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => handleViewFeedback(feedbackKey, d.variant?.product?.name || "Product")}
                                                            className="flex items-center gap-2 text-green-600"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                                />
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                                                />
                                                            </svg>
                                                            View Feedback
                                                        </ProductButton>
                                                        <ProductButton
                                                            variant="primary"
                                                            size="sm"
                                                            onClick={() => handleEditFeedbackClick(feedbackKey, d.variant?.product?.name || "Product")}
                                                            className="flex items-center gap-2"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                                />
                                                            </svg>
                                                            {existingFeedbacks[feedbackKey] ? "Edit Feedback" : "Add Feedback"}
                                                        </ProductButton>
                                                    </div>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })
                            ) : (
                                <div className="text-center py-12 text-gray-500">
                                    <p>No items in this order</p>
                                </div>
                            )}
                        </div>

                        {/* Refund Card */}
                        {order.refund_status && order.refund_status !== "not_applicable" && (
                            <div className="mt-6 bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 transition-shadow hover:shadow-sm">
                                <h4 className="font-semibold text-gray-700 mb-3">Refund Information</h4>
                                <div className="flex items-center gap-3 mb-3">
                                    <span className="text-gray-600 font-medium">Status:</span>
                                    {getStatusBadge(order.refund_status, "refund")}
                                </div>
                                {order.refund_proof && (
                                    <img
                                        src={order.refund_proof}
                                        alt="Refund Proof"
                                        className="w-32 h-32 object-cover rounded border cursor-pointer hover:opacity-80"
                                        onClick={() => setSelectedImage({ src: order.refund_proof, alt: "Refund Proof" })}
                                    />
                                )}
                            </div>
                        )}

                        {/* Order Feedback */}
                        {order.feedback_order && (
                            <div className="mt-4 p-4 sm:p-5 bg-blue-50 rounded-xl border border-blue-200">
                                <h4 className="font-semibold text-blue-700 mb-2">Order Feedback</h4>
                                <p className="text-gray-700">{order.feedback_order}</p>
                            </div>
                        )}

                        {(order.order_status?.toLowerCase() === "pending" ||
                            order.order_status?.toLowerCase() === "confirmed") && (
                                <ProductButton
                                    variant="danger"
                                    size="md"
                                    onClick={handleCancelOrder}
                                    className="mt-6"
                                >
                                    Cancel Order
                                </ProductButton>
                            )}
                    </div>
                )}
            </div>

            {/* Image Modal */}
            <ImageModal
                selectedImage={selectedImage}
                onClose={() => setSelectedImage(null)}
            />

            {/* View Feedback Modal */}
            {showViewFeedbackModal && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
                    onClick={() => setShowViewFeedbackModal(false)}
                >
                    <div
                        className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-6 relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setShowViewFeedbackModal(false)}
                            className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 text-2xl"
                        >
                            ×
                        </button>
                        <h3 className="text-xl font-semibold mb-4">Feedback for {selectedProductName}</h3>
                        {existingFeedbacks[selectedVariantId] ? (
                            <div className="space-y-3">
                                {existingFeedbacks[selectedVariantId].has_rating && existingFeedbacks[selectedVariantId].rating > 0 && (
                                    <div className="flex items-center">
                                        {[...Array(5)].map((_, i) => (
                                            <svg
                                                key={i}
                                                className={`w-5 h-5 ${i < existingFeedbacks[selectedVariantId].rating ? 'text-yellow-400' : 'text-gray-300'}`}
                                                fill="currentColor"
                                                viewBox="0 0 20 20"
                                            >
                                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                        ))}
                                    </div>
                                )}
                                {existingFeedbacks[selectedVariantId].has_content && existingFeedbacks[selectedVariantId].content?.trim() && (
                                    <p className="text-gray-700">{existingFeedbacks[selectedVariantId].content}</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-gray-600">No feedback provided yet.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Feedback Modal */}
            {showEditFeedbackModal && (
                <FeedbackForm
                    variantId={selectedVariantId}
                    onSubmit={existingFeedbacks[selectedVariantId] ? handleEditFeedback : handleFeedback}
                    initialRating={existingFeedbacks[selectedVariantId]?.rating || ''}
                    initialComment={existingFeedbacks[selectedVariantId]?.content || ''}
                    submitText={existingFeedbacks[selectedVariantId] ? 'Update Feedback' : 'Submit Feedback'}
                    showForm={true}
                    onCancel={() => setShowEditFeedbackModal(false)}
                    onDelete={handleDeleteFeedback}
                    isDeleting={loadingStates.deleting?.[selectedVariantId] || false}
                    showDeleteButton={!!existingFeedbacks[selectedVariantId]}
                    productName={selectedProductName}
                />
            )}

            {/* Confirmation Modal */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div
                        className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-4 sm:p-5 md:p-6"
                        onClick={(e) => e.stopPropagation()} // Prevent clicks from closing the modal
                    >
                        <div className="bg-gray-50 p-4 sm:p-5 rounded-xl border border-gray-200">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-medium text-gray-900">Cancel Order #{orderId}</h3>
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="text-gray-500 hover:text-gray-700 transition-colors p-2 rounded-md focus:outline-none"
                                    aria-label="Close cancel modal"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="space-y-4">
                                <p className="text-sm font-medium text-gray-600">Select a reason for cancelling order:</p>
                                {['address', 'voucher', 'product', 'demand'].map((reason) => (
                                    <div key={reason} className="flex items-center">
                                        <input
                                            type="radio"
                                            id={reason}
                                            name="cancelReason"
                                            value={reason}
                                            checked={cancelFormData.cancelReason === reason}
                                            onChange={(e) => setCancelFormData({ ...cancelFormData, cancelReason: e.target.value })}
                                            className="h-4 w-4 text-yellow-600 focus:ring-yellow-500 border-gray-300"
                                        />
                                        <label htmlFor={reason} className="ml-2 text-sm text-gray-900">
                                            {reason.charAt(0).toUpperCase() + reason.slice(1)}
                                        </label>
                                    </div>
                                ))}
                                <div className="flex items-center">
                                    <input
                                        type="radio"
                                        id="other"
                                        name="cancelReason"
                                        value="other"
                                        checked={cancelFormData.cancelReason === "other"}
                                        onChange={(e) => setCancelFormData({ ...cancelFormData, cancelReason: e.target.value, customReason: "" })}
                                        className="h-4 w-4 text-yellow-600 focus:ring-yellow-500 border-gray-300"
                                    />
                                    <label htmlFor="other" className="ml-2 text-sm text-gray-900">Other</label>
                                </div>
                                {cancelFormData.cancelReason === "other" && (
                                    <textarea
                                        value={cancelFormData.customReason}
                                        onChange={(e) => setCancelFormData({ ...cancelFormData, customReason: e.target.value })}
                                        placeholder="Enter custom reason"
                                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none"
                                        rows={3}
                                    />
                                )}
                                {error && (
                                    <div className="p-3 sm:p-4 bg-red-50 border-2 border-red-200 rounded-xl">
                                        <div className="flex items-center">
                                            <svg className="h-5 w-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <p className="text-sm text-red-800">{error}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-3 justify-end mt-6">
                                <ProductButton
                                    variant="secondary"
                                    size="md"
                                    onClick={() => setShowConfirmModal(false)}
                                >
                                    Cancel
                                </ProductButton>
                                <ProductButton
                                    variant="danger"
                                    size="md"
                                    onClick={handleSubmitCancel}
                                    disabled={!cancelFormData.cancelReason || (cancelFormData.cancelReason === "other" && !cancelFormData.customReason.trim())}
                                    className="flex items-center space-x-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>Confirm Cancel</span>
                                </ProductButton>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderDetailsModal;