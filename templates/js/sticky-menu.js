// sticky-menu.js

const stickyBar = document.querySelector('.stickybar');

if (stickyBar) {
    let stickyTriggerPoint = stickyBar.offsetHeight || 0; // Fallback nếu offsetHeight = 0 hoặc undefined

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function checkStickyState() {
        /*
        // Tạm thời ẩn phần code co lại giao diện khi scroll theo yêu cầu user
        // Kiểm tra nếu scrollY hoặc triggerPoint bất thường (NaN, undefined, hoặc 0)
        if (isNaN(window.scrollY) || window.scrollY === undefined || stickyTriggerPoint === undefined || stickyTriggerPoint === 0) {
            stickyBar.classList.add('is-sticky'); // Fallback: thêm class ngay để an toàn
            return;
        }

        const isOverScrolled = window.scrollY > (document.documentElement.scrollHeight - window.innerHeight);
        const currentScrollY = Math.max(0, window.scrollY); // Đảm bảo scrollY >= 0, tránh âm từ overscroll

        if (currentScrollY >= stickyTriggerPoint && !isOverScrolled) {
            stickyBar.classList.add('is-sticky');
        } else {
            stickyBar.classList.remove('is-sticky');
        }
        */
        // Đảm bảo luôn gỡ bỏ class để không bị co lại
        stickyBar.classList.remove('is-sticky');
    }

    const debouncedCheckStickyState = debounce(checkStickyState, 50);

    // Xử lý orientation change trên mobile
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            stickyTriggerPoint = stickyBar.offsetHeight || 0; // Recalculate sau delay
            checkStickyState();
        }, 500); // Delay để browser cập nhật
    });

    window.addEventListener('scroll', debouncedCheckStickyState);
    window.addEventListener('resize', () => {
        stickyTriggerPoint = stickyBar.offsetHeight || 0;
        debouncedCheckStickyState();
    });
    document.addEventListener('DOMContentLoaded', checkStickyState);
}