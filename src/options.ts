const field = document.querySelector<HTMLInputElement>('#token')!;

chrome.storage.local.get('token').then(({token}) => {
	field.value = (token as string | undefined) ?? '';
});

field.addEventListener('input', () => {
	void chrome.storage.local.set({token: field.value.trim()});
});
