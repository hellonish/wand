import { useEffect } from 'react';

export const usePageUnloadWarning = (shouldWarn: boolean, message: string = "Changes you made may not be saved.") => {
    useEffect(() => {
        if (!shouldWarn) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = message;
            return message;
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [shouldWarn, message]);
};
