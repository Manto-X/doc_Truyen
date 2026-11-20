const toggleTheme = () => {
        document.body.classList.toggle('dark');
        localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
document.body.classList.toggle('dark', localStorage.getItem('theme') === 'dark');