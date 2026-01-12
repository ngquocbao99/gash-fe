import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Chat, Close, PushPin, Send, MoreVert } from '@mui/icons-material';
import { AuthContext } from '../../context/AuthContext';
import io from 'socket.io-client';
import { SOCKET_URL } from '../../common/axiosClient';
import Api from '../../common/SummaryAPI';
import LiveStreamReactions from './LiveStreamReactions';

// ============= CommentInput Component (Inline) =============
const CommentInput = ({ onSendComment, isSending }) => {
    const [commentText, setCommentText] = useState('');
    const maxLength = 100;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!commentText.trim() || isSending) return;
        if (commentText.trim().length > 100) {
            return;
        }

        await onSendComment(commentText.trim());
        setCommentText('');
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    return (
        <div className="bg-gray-900/70 backdrop-blur-sm border-t border-gray-700/50 p-3">
            <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Write a comment..."
                    maxLength={maxLength}
                    className="flex-1 bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-400 focus:outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 transition-all duration-300"
                    disabled={isSending}
                />
                <button
                    type="submit"
                    disabled={!commentText.trim() || isSending}
                    className="bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-all duration-300 transform hover:scale-110 shadow-lg shadow-red-500/30 disabled:shadow-none disabled:transform-none"
                >
                    {isSending ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Send className="w-4 h-4" />
                    )}
                </button>
            </form>
            <div className="flex justify-between items-center mt-2 text-[10px] text-gray-400">
                <span className="text-gray-500">Press Enter to send</span>
                <span className={`font-medium ${commentText.length > maxLength * 0.9 ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {commentText.length}/{maxLength}
                </span>
            </div>
        </div>
    );
};

// ============= CommentItem Component (Inline) =============
const CommentItem = ({ comment, currentUserId, hostId, onHideComment, onPinComment, onUnpinComment }) => {
    const [showMenu, setShowMenu] = useState(false);

    // Backend returns senderId populated with { _id, name, username, image }
    // WebSocket returns sender with { _id, name, username, image }
    const senderData = comment.sender || comment.senderId;
    const senderName = senderData?.name || senderData?.username || 'Unknown User';
    const senderImage = senderData?.image || '/default-avatar.png';

    const isHost = currentUserId === hostId;
    const canDelete = (isHost || currentUserId === senderData?._id) && !comment.isPinned;
    const canPin = isHost && onPinComment;

    const formatTimeAgo = (timestamp) => {
        const now = new Date();
        const commentTime = new Date(timestamp);
        const diffMs = now - commentTime;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d`;
    };

    const handleHideComment = () => {
        // Prevent deletion of pinned comments
        if (comment.isPinned) {
            alert('Cannot delete a pinned comment. Please unpin it first.');
            return;
        }
        if (!onHideComment) return;
        onHideComment(comment._id);
        setShowMenu(false);
    };

    const handlePinToggle = () => {
        if (!onPinComment || !onUnpinComment) return;
        if (comment.isPinned) {
            onUnpinComment(comment._id);
        } else {
            onPinComment(comment._id);
        }
        setShowMenu(false);
    };

    return (
        <div className={`group relative p-3 rounded-lg transition-all duration-300 backdrop-blur-sm border ${comment.isPinned
            ? 'bg-gradient-to-r from-yellow-900/40 via-yellow-800/30 to-yellow-900/40 border-yellow-500/60 hover:border-yellow-400/80 shadow-lg shadow-yellow-500/20'
            : 'bg-gradient-to-r from-gray-800/40 via-gray-700/40 to-gray-800/40 border-gray-700/50 hover:bg-gray-800/60 hover:border-gray-600/60'
            }`}>
            <div className="flex items-start gap-2.5">
                <div className="relative flex-shrink-0">
                    <img
                        src={senderImage}
                        alt={senderName}
                        className="w-9 h-9 rounded-lg object-cover border-2 border-white/10 shadow-lg"
                        onError={(e) => { e.target.src = '/default-avatar.png'; }}
                    />
                    {comment.isPinned && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full border border-gray-900 flex items-center justify-center shadow-lg">
                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" />
                            </svg>
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-white font-semibold text-xs truncate">{senderName}</span>
                        {/* Host Badge */}
                        {senderData?._id === hostId && (
                            <span className="px-1.5 py-0.5 bg-gradient-to-r from-red-600 to-pink-600 text-white text-[9px] font-bold rounded border border-red-400/50 shadow-sm">
                                HOST
                            </span>
                        )}
                        <span className="text-gray-400 text-[10px]">{formatTimeAgo(comment.createdAt)}</span>
                    </div>
                    <p className="text-gray-200 text-xs break-words leading-relaxed">{comment.commentText || comment.content}</p>
                    {comment.isPinned && (
                        <p className="text-[9px] text-yellow-400 font-bold mt-0.5">PINNED</p>
                    )}
                </div>

                {(canDelete || canPin) && (onHideComment || onPinComment) && (
                    <div className="relative">
                        <button
                            onClick={() => setShowMenu(!showMenu)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white p-1.5 rounded-lg transition-all hover:bg-gray-700/50"
                        >
                            <MoreVert className="w-4 h-4" />
                        </button>
                        {showMenu && (
                            <div className="absolute right-0 top-10 bg-gray-900/98 backdrop-blur-md border border-gray-700/50 rounded-xl shadow-2xl z-10 min-w-[140px] overflow-hidden">
                                {canPin && (
                                    <button
                                        onClick={handlePinToggle}
                                        className="w-full px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-gradient-to-r hover:from-yellow-900/30 hover:to-yellow-800/20 flex items-center gap-2 transition-all"
                                    >
                                        <PushPin className="w-4 h-4" />
                                        {comment.isPinned ? 'Unpin' : 'Pin'}
                                    </button>
                                )}
                                {canDelete && (
                                    <button
                                        onClick={handleHideComment}
                                        className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-gradient-to-r hover:from-red-900/30 hover:to-red-800/20 flex items-center gap-2 transition-all"
                                    >
                                        <Close className="w-4 h-4" />
                                        Delete
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ============= Main LiveStreamComments Component =============

const LiveStreamComments = ({ liveId, hostId, isVisible, onToggle }) => {
    const { user } = useContext(AuthContext);
    const [comments, setComments] = useState([]);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState(null);
    const commentsEndRef = useRef(null);
    const commentsContainerRef = useRef(null);
    const refreshIntervalRef = useRef(null);
    const socketRef = useRef(null);
    const previousCommentsLengthRef = useRef(0);

    const fetchComments = useCallback(async () => {
        if (!liveId || !user) return;

        try {
            setError(null);
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await Api.livestream.getComments(liveId, token);

            if (response.data?.success) {
                // Backend returns: { success: true, data: comments, count, totalCount, ... }
                // data is the array of comments directly
                const comments = response.data.data || [];
                // Ensure isPinned is explicitly set for all comments (default to false if not provided)
                const commentsWithPin = comments.map(c => ({
                    ...c,
                    isPinned: c.isPinned ?? false
                }));
                // Sort: pinned first, then oldest to newest
                const sortedComments = commentsWithPin.sort((a, b) => {
                    if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
                    return new Date(a.createdAt) - new Date(b.createdAt); // Oldest to newest
                });
                setComments(sortedComments);

                // Auto-scroll to bottom after loading comments
                setTimeout(() => {
                    if (commentsContainerRef.current) {
                        const container = commentsContainerRef.current;
                        container.scrollTo({
                            top: container.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                }, 100);
            } else {
                setError('Failed to load comments');
            }
        } catch (error) {
            console.error('Error fetching comments:', error);
            setError('Error loading comments');
        }
    }, [liveId, user]);

    const handleSendComment = async (content) => {
        if (!user || !liveId) return;

        try {
            setIsSending(true);
            const token = localStorage.getItem('token');
            if (!token) return;

            // Backend expects: { liveId, commentText }
            const response = await Api.livestream.addComment({
                liveId,
                commentText: content
            }, token);

            if (response.data?.success) {
                // Comment will be added automatically via WebSocket in real-time
                // No need to fetch again - WebSocket handles it
                // Auto-scroll to bottom after sending comment
                setTimeout(() => {
                    if (commentsContainerRef.current) {
                        const container = commentsContainerRef.current;
                        container.scrollTo({
                            top: container.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                }, 300);
            } else {
                const errorMsg = response.data?.message || 'Unable to send comment';
                if (errorMsg.includes('at most 100') || errorMsg.includes('100 characters')) {
                    setError('Comment must be at most 100 characters');
                } else if (errorMsg.includes('required') || errorMsg.includes('fill in')) {
                    setError('Please fill in all required fields');
                } else {
                    setError(errorMsg);
                }
            }
        } catch (error) {
            console.error('Error sending comment:', error);
            const errorMsg = error?.response?.data?.message || error?.message || 'Error sending comment';
            if (errorMsg.includes('at most 100') || errorMsg.includes('100 characters')) {
                setError('Comment must be at most 100 characters');
            } else if (errorMsg.includes('required') || errorMsg.includes('fill in')) {
                setError('Please fill in all required fields');
            } else {
                setError(errorMsg);
            }
        } finally {
            setIsSending(false);
        }
    };

    const handleHideComment = async (commentId) => {
        if (!user || !liveId) return;

        try {
            setIsSending(true);
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await Api.livestream.hideComment(commentId, token);

            if (response.data?.success) {
                // Comment will be deleted automatically via WebSocket in real-time
            } else {
                setError(response.data?.message || 'Unable to delete comment');
            }
        } catch (error) {
            console.error('Error deleting comment:', error);
            setError('Error deleting comment');
        } finally {
            setIsSending(false);
        }
    };

    // Setup WebSocket for real-time comments
    useEffect(() => {
        if (!isVisible || !liveId || !user) return;

        // Connect to socket
        const socket = io(SOCKET_URL, { transports: ['websocket'] });
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('joinLiveProductRoom', liveId);
        });

        // Listen for new comments (real-time)
        socket.on('comment:added', (data) => {
            // Normalize liveId comparison (handle both string and ObjectId)
            const dataLiveId = data?.liveId?.toString?.() || data?.liveId;
            const currentLiveId = liveId?.toString?.() || liveId;
            if (data?.comment && dataLiveId === currentLiveId) {
                const newComment = data.comment;
                // Normalize: socket uses 'sender', API uses 'senderId'
                if (newComment.sender && !newComment.senderId) {
                    newComment.senderId = newComment.sender;
                }
                // Ensure createdAt exists
                if (!newComment.createdAt) {
                    newComment.createdAt = new Date().toISOString();
                }

                setComments(prev => {
                    // Check if comment already exists (prevent duplicates)
                    const exists = prev.some(c => c._id === newComment._id);
                    if (exists) {
                        // Update existing comment to preserve isPinned if it was already set
                        return prev.map(c =>
                            c._id === newComment._id
                                ? { ...c, ...newComment, isPinned: c.isPinned || newComment.isPinned }
                                : c
                        );
                    }
                    // Ensure isPinned is explicitly set (default to false if not provided)
                    const commentWithPin = {
                        ...newComment,
                        isPinned: newComment.isPinned ?? false
                    };
                    // Add new comment and maintain sort (pinned first, then oldest to newest)
                    const updated = [...prev, commentWithPin].sort((a, b) => {
                        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
                        return new Date(a.createdAt) - new Date(b.createdAt); // Oldest to newest
                    });
                    return updated;
                });

                // Auto scroll to bottom when new comment arrives
                setTimeout(() => {
                    if (commentsContainerRef.current) {
                        const container = commentsContainerRef.current;
                        // Always scroll to bottom for new comments
                        container.scrollTo({
                            top: container.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                }, 200);
            }
        });

        // Listen for comment deletion (if user sends comment that gets deleted)
        socket.on('comment:deleted', (data) => {
            // Normalize liveId comparison (handle both string and ObjectId)
            const dataLiveId = data?.liveId?.toString?.() || data?.liveId;
            const currentLiveId = liveId?.toString?.() || liveId;
            if (data?.commentId && dataLiveId === currentLiveId) {
                setComments(prev => prev.filter(c => c._id !== data.commentId));
            }
        });

        // Listen for comment pin/unpin (real-time updates)
        socket.on('comment:pinned', (data) => {
            // Normalize liveId comparison (handle both string and ObjectId)
            const dataLiveId = data?.liveId?.toString?.() || data?.liveId;
            const currentLiveId = liveId?.toString?.() || liveId;
            if (data?.comment && dataLiveId === currentLiveId) {
                setComments(prev => {
                    const updated = prev.map(c =>
                        c._id === data.comment._id
                            ? { ...c, isPinned: true }
                            : c
                    );
                    // Re-sort after pinning
                    return updated.sort((a, b) => {
                        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
                        return new Date(a.createdAt) - new Date(b.createdAt);
                    });
                });
            }
        });

        socket.on('comment:unpinned', (data) => {
            // Normalize liveId comparison (handle both string and ObjectId)
            const dataLiveId = data?.liveId?.toString?.() || data?.liveId;
            const currentLiveId = liveId?.toString?.() || liveId;
            if (data?.commentId && dataLiveId === currentLiveId) {
                setComments(prev => {
                    const updated = prev.map(c =>
                        c._id === data.commentId
                            ? { ...c, isPinned: false }
                            : c
                    );
                    // Re-sort after unpinning
                    return updated.sort((a, b) => {
                        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
                        return new Date(a.createdAt) - new Date(b.createdAt);
                    });
                });
            }
        });

        // Handle connection errors
        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
        });

        socket.on('disconnect', (reason) => {
            console.warn('WebSocket disconnected:', reason);
        });

        return () => {
            socket.disconnect();
            if (socketRef.current === socket) {
                socketRef.current = null;
            }
        };
    }, [isVisible, liveId, user]);

    // Initial load and periodic sync (WebSocket handles real-time updates)
    useEffect(() => {
        if (isVisible && liveId) {
            // Initial load
            fetchComments();

            // Periodic sync every 30 seconds (WebSocket handles real-time, this is just for consistency)
            refreshIntervalRef.current = setInterval(() => {
                fetchComments();
            }, 30000);

            return () => {
                if (refreshIntervalRef.current) {
                    clearInterval(refreshIntervalRef.current);
                }
            };
        }
    }, [isVisible, liveId, fetchComments]);

    // Auto-scroll when new comments arrive
    useEffect(() => {
        const currentTotalLength = comments.length;
        const previousTotalLength = previousCommentsLengthRef.current;

        // Auto-scroll if:
        // 1. Comments length increased (new comment added)
        // 2. Comments container is visible
        // 3. Not initial load (previousTotalLength > 0)
        if (previousTotalLength > 0 && currentTotalLength > previousTotalLength && isVisible && commentsContainerRef.current) {
            setTimeout(() => {
                const container = commentsContainerRef.current;
                if (container) {
                    // Always scroll to bottom for new comments
                    container.scrollTo({
                        top: container.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            }, 150);
        }

        previousCommentsLengthRef.current = currentTotalLength;
    }, [comments, isVisible]);

    if (!isVisible) return null;

    return (
        <div className="fixed right-0 top-0 h-full w-[352px] bg-black/95 backdrop-blur-xl border-l border-gray-800/50 flex flex-col z-[45] shadow-2xl pointer-events-auto">
            <div className="bg-gradient-to-br from-black via-gray-900 to-black p-3 flex items-center justify-between border-b border-gray-700/50 shadow-lg">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20">
                        <Chat className="w-4 h-4 text-white" />
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-sm">Comments</h3>
                        <p className="text-white/70 text-[10px]">Live chat</p>
                    </div>
                </div>
                {/* <button
                    onClick={onToggle}
                    className="text-white hover:bg-white/20 p-1.5 rounded-full transition-all duration-300 hover:scale-110 transform border border-white/10"
                >
                    <Close className="w-4 h-4" />
                </button> */}
            </div>

            {/* Reactions Section - Same row as header */}
            {liveId && (
                <div className="bg-gradient-to-r from-gray-900/60 via-gray-800/40 to-gray-900/60 border-b border-gray-700/50 p-2 backdrop-blur-sm">
                    <div className="flex justify-center">
                        <LiveStreamReactions liveId={liveId} horizontal={true} showComments={isVisible} />
                    </div>
                </div>
            )}

            {/* Pinned Comments Section - Sticky below reactions */}
            {comments.some(c => c.isPinned) && (
                <div className="bg-yellow-900/30 border-b border-yellow-500/40">
                    {/* Pinned Comment Content */}
                    <div className="p-3 max-h-40 overflow-y-auto scrollbar-livestream">
                        {comments
                            .filter(c => c.isPinned)
                            .slice(0, 1)
                            .map((comment) => (
                                <CommentItem
                                    key={comment._id}
                                    comment={comment}
                                    currentUserId={user?._id}
                                    hostId={hostId}
                                    onHideComment={handleHideComment}
                                    onPinComment={undefined}
                                    onUnpinComment={undefined}
                                />
                            ))}
                    </div>
                </div>
            )}

            {/* Regular Comments Section - Scrollable */}
            <div
                className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-livestream"
                ref={commentsContainerRef}
            >
                {error && (
                    <div className="bg-red-900/30 backdrop-blur-sm border border-red-500/50 text-red-300 p-3 rounded-lg text-xs shadow-lg">
                        <div className="flex items-center gap-2">
                            <span>⚠️</span>
                            <span>{error}</span>
                        </div>
                    </div>
                )}

                {comments.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-sm border border-gray-700/50">
                            <Chat className="w-8 h-8 text-gray-600" />
                        </div>
                        <p className="text-gray-300 text-sm font-medium mb-1">No comments yet</p>
                        <p className="text-gray-500 text-xs">Be the first to comment!</p>
                    </div>
                ) : (
                    <>
                        {comments
                            .filter(c => !c.isPinned)
                            .map((comment, index, filteredArray) => {
                                // Mark last 3 comments as "new" for visual feedback
                                const isNewComment = index >= filteredArray.length - 3;
                                return (
                                    <div
                                        key={comment._id}
                                        className={isNewComment ? 'animate-fade-in' : ''}
                                    >
                                        <CommentItem
                                            comment={comment}
                                            currentUserId={user?._id}
                                            hostId={hostId}
                                            onHideComment={handleHideComment}
                                            onPinComment={undefined}
                                            onUnpinComment={undefined}
                                        />
                                    </div>
                                );
                            })}
                        <div ref={commentsEndRef} />
                    </>
                )}
            </div>

            {user ? (
                <CommentInput
                    onSendComment={handleSendComment}
                    isSending={isSending}
                />
            ) : (
                <div className="bg-gray-900/70 backdrop-blur-sm border-t border-gray-700/50 p-5 text-center">
                    <p className="text-gray-300 text-sm">
                        <a href="/login" className="text-red-400 hover:text-red-500 font-medium transition-colors underline underline-offset-2">
                            Login
                        </a>{' '}
                        <span className="text-gray-400">to comment</span>
                    </p>
                </div>
            )}
        </div>
    );
};

export default LiveStreamComments;
