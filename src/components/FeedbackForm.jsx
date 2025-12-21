// src/components/FeedbackForm.jsx
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star } from "lucide-react";
import ProductButton from "./ProductButton";
import LoadingSpinner from "./LoadingSpinner";
import ConfirmationModal from "./ConfirmationModal";

const FeedbackForm = ({
    variantId,
    onSubmit,
    initialRating = 5,
    initialComment = "",
    submitText = "Submit Review",
    showForm = false,
    onCancel,
    onDelete,
    isDeleting = false,
    showDeleteButton = false,
    productName = "",
    existingFeedback = null,
}) => {
    const [open, setOpen] = useState(showForm);
    const [comment, setComment] = useState(initialComment);
    const [rating, setRating] = useState(initialRating);
    const [hoverRating, setHoverRating] = useState(0);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Sync open state with showForm prop
    useEffect(() => {
        setOpen(showForm);
    }, [showForm]);

    const handleSubmit = (e) => {
        e.preventDefault();

        // Validate that rating is selected
        if (!rating || rating < 1) {
            alert("Please select a rating before submitting.");
            return;
        }

        onSubmit(variantId, comment, rating);
        setOpen(false);
        setComment(initialComment);
        setRating(initialRating);
    };

    return (
        <>
            {!showForm && (
                <ProductButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpen(true)}
                    className="mt-2"
                >
                    Write a Review
                </ProductButton>
            )}

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4"
                        onClick={() => {
                            setOpen(false);
                            onCancel?.();
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-4 sm:p-5 md:p-6">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
                                        Feedback for {productName || "Product"}
                                    </h3>

                                    {/* Trash icon - only shown if feedback exists and not deleting */}
                                    {showDeleteButton && (
                                        <button
                                            onClick={() => setShowDeleteConfirm(true)}
                                            disabled={isDeleting}
                                            className={`p-2 rounded-lg transition ${
                                                isDeleting
                                                    ? 'text-gray-400 cursor-not-allowed'
                                                    : 'text-red-600 hover:bg-red-50'
                                            }`}
                                            title="Delete Feedback"
                                        >
                                            {isDeleting ? (
                                                <LoadingSpinner size="sm" color="red" />
                                            ) : (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                                </svg>
                                            )}
                                        </button>
                                    )}
                                </div>

                                {/* Deleted state: simple centered message */}
                                {existingFeedback?.is_deleted || initialComment === 'This feedback has been deleted by staff/admin' ? (
                                    <div className="py-8 text-center">
                                        <p className="text-gray-600 italic text-base">
                                            This feedback has been deleted by staff/admin
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Star rating */}
                                        <div className="flex justify-center mb-6">
                                            {[1, 2, 3, 4, 5].map((r) => (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onMouseEnter={() => setHoverRating(r)}
                                                    onMouseLeave={() => setHoverRating(0)}
                                                    onClick={() => setRating(r)}
                                                    className="focus:outline-none"
                                                >
                                                    <Star
                                                        size={32}
                                                        className={`transition-transform ${
                                                            (hoverRating || rating) >= r
                                                                ? "fill-yellow-400 text-yellow-400 scale-110"
                                                                : "text-gray-300"
                                                        }`}
                                                    />
                                                </button>
                                            ))}
                                        </div>

                                        {/* Comment textarea */}
                                        <textarea
                                            placeholder="Share your thoughts about this product... (Optional)"
                                            value={comment}
                                            onChange={(e) => setComment(e.target.value)}
                                            className="w-full border border-gray-300 rounded-xl p-3 mb-6 resize-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 transition outline-none"
                                            rows={4}
                                        />

                                        {/* Action buttons */}
                                        <div className="flex justify-end gap-3">
                                            <ProductButton
                                                type="button"
                                                variant="secondary"
                                                size="md"
                                                onClick={() => {
                                                    setOpen(false);
                                                    onCancel?.();
                                                }}
                                            >
                                                Cancel
                                            </ProductButton>

                                            <ProductButton
                                                type="submit"
                                                variant="primary"
                                                size="md"
                                                disabled={!rating || rating < 1}
                                            >
                                                {submitText}
                                            </ProductButton>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Close × button */}
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onCancel?.();
                                }}
                                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all duration-200 z-10"
                                aria-label="Close modal"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete Feedback Confirmation Modal */}
            {showDeleteButton && (
                <ConfirmationModal
                    isOpen={showDeleteConfirm}
                    title="Delete Feedback"
                    message="Are you sure you want to delete this feedback? This action cannot be undone."
                    confirmText="Delete"
                    cancelText="Cancel"
                    variant="danger"
                    onConfirm={() => {
                        setShowDeleteConfirm(false);
                        onDelete?.();
                    }}
                    onCancel={() => setShowDeleteConfirm(false)}
                />
            )}
        </>
    );
};

export default FeedbackForm;
